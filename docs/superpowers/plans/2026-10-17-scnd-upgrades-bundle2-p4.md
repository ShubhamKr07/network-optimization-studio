# SCND Upgrades — Bundle 2 Phase P4 Implementation Plan (input tables, +Add modal, demand cell)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. At execution start, seed a TaskCreate entry per task **and** per process gate (each task's gate run, local e2e run, changelog entry, the phase-exit checks, the QA pass, the Docker build, `/harness-retro`, `superpowers:finishing-a-development-branch`), per the standing ledger rule.

**Goal:** Move every Workspace **input** table onto the P1 `DataTable` shell — the 7 distance/cost instances and the 14 entity instances of matrix §1 (rows #10–#30) — with Upload ▾ / Download ▾ (CSV + JSON, expected-fields panel) on every input table except the Plant Capability Matrix and JADE Transport Costs, the FilterMenu replacing the From/To boxes (every table > 10 rows, all models), the pager only above 50 rows, numbers centre-aligned, history read-only on every editable control (D2), the B2.8 "+ Add {Entity}" modal for the six entities, and the B2.9 `FormattedNumberInput` demand cell (customers, JADE per-product, stations in integer mode).

**Architecture:** Each input tab keeps its own row derivation and write logic and becomes a thin adapter around `<DataTable>`: a `ColumnDef<Row>[]` rebuilt per render (column ids = today's filter keys), a literal `testIds` map, a **required** `ctx` carrying the live history flag, and toolbar slots. Entity tabs render base + added rows as two `sections` under one toolbar, one FilterMenu and one pager. Four small shared pieces arrive first: `useEntityFileMenus` (Upload ▾ = P3's `DownloadMenu` reused with an additive `label`/`children`; Download ▾ = `DownloadMenu`; both carry the `ExpectedFieldsPanel` built from `@workspace/import-schema`), an RTL + a Playwright helper module, and a source-scan guard that every input-tab mount in `Workspace.tsx` receives the history flag. `CreateEntityDialog` gains a `source: "table"` mode (the map flow is untouched); `entityCells.tsx` holds the status toggle, delete button, draft capacity input and the `DemandCell` wrapper around `FormattedNumberInput`. The legacy `components/tables/{Warehouse,Customer,Mine,Station}Table.tsx` stay for `Studio.tsx` and are no longer rendered by the Workspace.

**Tech Stack:** React 18 + TypeScript + Vite (`artifacts/studio`), Tailwind, Radix popover/dialog, vitest 3 + React Testing Library 16 + user-event 14 (jsdom), Playwright (`artifacts/studio/e2e`), `@workspace/import-schema` (P2).

**Inputs (source of truth):** spec `docs/superpowers/specs/2026-10-16-scnd-upgrades-design.md` rev 4 (B2.1–B2.4, B2.8, B2.9, B2.10, D1–D4, "Risks and mitigations"); P1 plan `docs/superpowers/plans/2026-10-17-scnd-upgrades-bundle2-p1.md` ("Interfaces", "Adapter rules", "Hand-off to P4"); P2 plan `…-bundle2-p2.md` (import-schema exports, `ImportDialog` `format`, `deliveryCosts`); P3 plan `…-bundle2-p3.md` (`DownloadMenu`, `chooseDownload`); matrix `…-bundle2-matrix.md` (§1 rows #10–#30, §2b/§2c testid maps, §3 inventory, §4 G1–G21, §5). User decisions of 2026-10-17 listed under "Decisions applied".

## Global Constraints

- **Workdir / branch / base:** bundle branch `scnd-upgrades` in `/Users/shubhamkr/nos-scnd-upgrades`. P4 starts only after P1, P2 and P3 are complete and cherry-picked onto `scnd-upgrades`. The lead records `B1_TIP` (from P1's Step L0) and `P3_TIP` (`git rev-parse scnd-upgrades` after the last `[SCU-2.P3.N]` commit) in every dispatch brief. Each task runs in its own pre-created locked worktree (see "Execution topology"); its first Bash command is `cd /Users/shubhamkr/nos-scu-2.p4.N && git rev-parse --abbrev-ref HEAD`, which must print `scu-2.p4.N-work`, otherwise STOP. Never touch `/Users/shubhamkr/network-optimization-studio`.
- **Base guards (every task, right after the branch check, each alone):** `git merge-base --is-ancestor "$B1_TIP" HEAD || exit 1` and `git merge-base --is-ancestor "$P3_TIP" HEAD || exit 1`, plus `test -f artifacts/studio/src/components/data-table/DataTable.tsx && test -f artifacts/studio/src/components/data-table/DownloadMenu.tsx && test -d lib/import-schema || exit 1` (P1, P3 and P2 landed).
- **Full-file replacements are guarded.** Every task that replaces a tab file wholesale first runs `git diff --quiet 46d2f98 HEAD -- <that file>`; Bundle 1 and P1–P3 do not edit any input tab, so a non-zero exit means someone did — STOP and re-apply the change by hand against the new text. Every edit script asserts each anchor occurs exactly once and STOPs otherwise.
- **Dependencies:** a fresh worktree has no `node_modules`. Run `pnpm install --frozen-lockfile` once per worktree before Step 1. pnpm only.
- **Before every `git commit`:** run `[ "$(git rev-parse --abbrev-ref HEAD)" != "main" ] || exit 1` **alone**, read its output, then commit **with an explicit pathspec**. New files need `git add <file>` first; a deleted file needs `git rm <file>`. Never pipe a state-changing git command.
- **One task = one commit**, message `[SCU-2.P4.N] <imperative summary>`, body ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. A spec change that crosses tab + Workspace + tests + e2e is one commit (root gotcha "a change crossing a layer boundary is ONE commit").
- **Changelog in the same commit (hard rule #9):** every task appends `### SCU-2.P4.N — <title>` at the bottom of `docs/CHANGELOG-implementation.md` (under P1.1's `## SCU-B2` heading). Numbers come from that task's own run; anything underivable is the literal `unknown`. A cherry-pick conflict that is only two bottom-appended changelog blocks is resolved by keeping both in task-id order.
- **Hard rule #12:** SCU-2.P4.1–P4.14 are owned by **frontend-engineer** and begin with Step 0: invoke `andrej-karpathy-skills:karpathy-guidelines`, then `ponytail:ponytail`, via the Skill tool, and say so in the report. Review: latest Opus + `ponytail:ponytail-review`. SCU-2.P4.15 is **qa-sdet** (exempt from both skills; if a ponytail ruleset is injected anyway, ignore it and say so). SCU-2.P4.16 is the lead.
- **Never edit generated code** (`lib/api-zod/src/generated/`, `lib/api-client-react/src/generated/`). P4 has no OpenAPI change; if a task seems to need one, STOP and escalate.
- **No server, solver or DB change.** `solve.py`, `e2e_accuracy.py`, `lib/db/**`, `artifacts/api-server/**` are untouched. Each task asserts `git diff --stat "$P3_TIP"..HEAD -- artifacts/api-server lib/db lib/api-spec` prints nothing.
- **Spec values, verbatim (B2.1–B2.4, B2.8, B2.9, D2–D4):**
  - Filter menu top-right **when effective rows > 10**, on every model; it replaces `input-filter-from/to`; base and added sections share **one** menu (incl. JADE Plants); trigger testid `button-filter-menu-trigger`.
  - Page size **50**; the pager renders **only when filtered rows > 50**.
  - **`kind: "number"` header + cell centre-aligned**; cell inputs `w-full`, no fixed widths.
  - `readOnly` (history) applies to **every** editable cell in base, added and JADE rows (D2) — here also the row delete buttons and the "+ Add" / "+ Add row" triggers.
  - Upload ▾ (CSV / JSON) → existing `ImportDialog` with the chosen `format`; Download ▾ (CSV / JSON) → `useExport().download(entity, format)`; both are disabled while browsing history with the same reason (user answer 2026-10-17); both carry the expected-fields panel (CSV header / JSON key, type, required add vs update, enum values, numeric bounds, unit, example CSV + example JSON envelope). Tables: Warehouses/Refineries, Customers, Plants, Mines, Stations, Distances, Leg Distances, JADE Distances, Lane Costs, **Delivery Costs**. **Not:** Plant Capability Matrix, JADE Transport Costs.
  - "+ Add {Entity}" modal for warehouse, customer, plant, mine, station, refinery only; lat/lng **editable** from a table, prefilled read-only from the map; refinery no capacity, plant no value/status, mine capacity, station demand; same validation messages as the inline forms; trigger testids `button-add-{warehouse|customer|plant|mine|station}-row`, refinery keeps `button-add-warehouse-row` (D4); fields `create-entity-*`. Distance/cost tables — **including Delivery Costs** — keep their inline "+ Add row".
  - Demand cell: `FormattedNumberInput`, grouped display, live reformat, a visible suffix linked by `aria-describedby`, set per adapter (**"Units"** for customers, **"tons"** for stations — user answer 2026-10-17), **no aria-label added**; `null` = empty = clear override on base rows (D3); decimals allowed; station demand in **integer** mode; Brazil `!demandEditable` locks **base** demand only; the add form **blocks submit on an empty demand** (incl. JADE per-product).
- **Gate (every task; scripts verified to exist: root `package.json` `typecheck`, `artifacts/studio/package.json` `typecheck:e2e` / `test`, `artifacts/api-server/package.json` `test`, `lib/import-schema` `test` from P2):** run each separately and judge it by its own exit status:
  1. `cnt=$(ps aux | grep "[v]itest" | grep -v "zsh -c" | wc -l | tr -d ' '); [ "$cnt" = "0" ]` — alone, never chained with `&&`.
  2. `pnpm run typecheck`
  3. `pnpm --filter studio typecheck:e2e`
  4. `DATABASE_URL="postgresql://shubhamkr@localhost:5432/nos_dev" pnpm --filter api-server test`
  5. `pnpm --filter studio test`
  6. `(cd artifacts/api-server/src/solver && python3 -m pytest tests/ -x)`
  7. `pnpm --filter @workspace/import-schema test`
- **Local e2e (every migration task; recipe from `artifacts/studio/e2e/CLAUDE.md`):** api-server `DATABASE_URL="postgresql://shubhamkr@localhost:5432/nos_dev" PORT=3001 pnpm --filter api-server run dev`, studio `PORT=5179 BASE_PATH=/ API_PROXY_TARGET=http://localhost:3001 VITE_POSTHOG_KEY=phc_local_dummy_key VITE_SENTRY_DSN=https://x@o.ingest.sentry.io/1 pnpm --filter studio run dev`, then `cd artifacts/studio && E2E_BASE_URL=http://localhost:5179 npx playwright test <the task's spec list>`. **`E2E_BASE_URL` is never optional** (without it Playwright silently tests a remote Replit deployment). Record pass/fail per spec; a failure is checked against `docs/superpowers/flake-registry.md` by test **name** and re-run twice in isolation before it is called a regression. `@flaky`-tagged specs run with `npx playwright test --grep @flaky <spec>`.
- **Flakes:** api-server vitest, studio vitest and Playwright all flake under load (root gotcha). Check the registry by test name, re-run the file twice in isolation, record new sightings in the registry.
- **No merge, no push, no deploy** inside a task. The phase ends at SCU-2.P4.16's STOP for the user's merge approval; merge, push and deploy are each a separate approval (root "Branch discipline").

## Decisions applied (user, 2026-10-17 — final, not re-asked)

- **D1** Delivery Costs import/export is sparse (P2's `deliveryCosts` entity). **D2** history read-only on every editable control of every input table, including Plants/Mines/Stations and all distance/cost tabs (matrix §5 item 8: six of seven had no prop; writes were silently dropped at `Workspace.tsx` `updateInputsField`). **D3** demand decimals allowed; empty clears the override on base rows. **D4** refinery trigger keeps `button-add-warehouse-row`.
- Station demand: `FormattedNumberInput` integer mode. Add-customer form: empty demand **blocks** submit (incl. JADE per-product, which used to turn a blank into 0). An **already-added** customer's demand cell emptied → **not saved**; on blur it reverts to the last valid value. No aria-label is added to demand inputs. JADE Plants base + added share ONE filter menu. Delivery Costs keeps its inline "+ Add row"; delivery gets no entity adds. Modal lat/lng editable from a table, prefilled read-only from the map.
- Known by-design e2e breaks rewritten here: "Page 1 of 1" pager asserts (`bundle5-homepage-distances.spec.ts`), `workspace-fixups-2.spec.ts` "no FilterMenu on the 26-row non-JADE warehouses tab", and the `Number(inputValue())` demand reads (`import.spec.ts`, `chen-bands-units-qa.spec.ts`, `max-coverage.spec.ts`).

## Spec deviations and grounding facts (read before any task)

Each is the smallest correct reading where the spec/plans and the repo disagree (hard rule #8); the commit that implements one names it in its body. All were measured in a scratch build (see "Verification at plan time").

1. **One commit per tab, not per matrix row.** The matrix counts base and added rows as separate instances (#17–#30), but each tab renders them as ONE `DataTable` with two `sections` under one toolbar, one FilterMenu and one pager (spec B2.2 "base and added sections share one menu"). Splitting base from added would leave an intermediate commit whose filter covers only half the rows, i.e. a B2.2 violation on `main`'s history. So: Warehouses + Refineries (#17–#20, one component) = SCU-2.P4.10; scalar + JADE Customers (#21–#24, one component) = SCU-2.P4.11; Plants (#25–#26), Mines (#27–#28), Stations (#29–#30) one each. The seven distance/cost tables are one commit each (#10–#16). 21 instances → 12 migration commits.
2. **B2.8 modal first, B2.9 folded in.** The table mode of `CreateEntityDialog` lands alone (SCU-2.P4.2, no consumers) so each entity migration wires it directly instead of first porting six inline forms into section footers and deleting them a commit later. The B2.9 demand application is folded into the Customers (P4.11) and Stations (P4.14) migrations: writing a throwaway `<Input type="number">` cell and replacing it in the next commit would double the e2e rewrites for no benefit.
3. **Adapters do not memoise `columns`.** P1's "memoise columns" note is a performance hint: `DataTable` derives descriptors with `useMemo([columns, rows])`, and neither `DataTable` nor `FilterMenu` holds any effect keyed on the columns' identity (measured: `FilterMenu.tsx` has no hook at all). Input cells close over live props, and Workspace passes inline `onChange` arrows over `updateInputsField`; a memoised column array would write through a stale closure. P4 adapters rebuild `columns` per render (DeliveryCosts memoises only its ~10,329 `rows`).
4. **Deleting a row resets to page 1** (spec rev 4 B2.2: the reset key is the key set of ALL effective rows). `DistancesTab.test.tsx`'s "clamps down on delete … lands on the new last page" becomes "deleting a row resets to page 1 of the new page count".
5. **Banners move above the toolbar.** `DataTable` owns the toolbar row, so the Distances / JADE Distances reference loading/error banners (matrix G19) render above it, and the compat wrappers `distances-reference-section` / `jadedistances-reference-section` now wrap the whole `DataTable` (toolbar included). No e2e references either wrapper (matrix §2b).
6. **Focus token includes the row count.** Today's focus effect depended on the merged row list, so a jump requested before the reference matrix loaded ran again once it had. `DataTable`'s focus runs on `token` change only, so Distances / JADE Distances pass `token: \`${focusEntityId}|${rows.length}\``. LegDistances / LaneCosts focus used to be scroll-only; through `DataTable` it now also clears filters and pages (spec B2.2's one focus behaviour).
7. **Upload ▾ reuses P3's `DownloadMenu`** with two additive props, `label` (default "Download") and `children` (rendered under the items — the expected-fields panel). Testids: Upload trigger `button-import-{t}` (today's id), items `button-import-{t}-csv|json` (new); Download trigger `button-download-{t}` (P3's convention), items keep today's `button-export-{t}-csv|json`. `{t}` is the lowercase name today's ids already use (`legdistances`, `lanecosts`; new for delivery: `deliverycosts`). P1's `DataTableToolbar.downloadAlign?: "left" | "right"` defaults to left, which is what input tables want, so P4 passes nothing (outputs pass "right" in P3). P3.7's shell change (`showFilter = rows > 10 && descriptors.length > 0`) does not change any input table: every one has filterable columns (Transport Costs has two rows, so no menu either way). P3 dropped its generic client-CSV helpers; P4 never used them. P3's e2e `downloadVia` captures a real download event; P4's `chooseMenuItem` is for the Upload ▾ items (no download) and the chen spec's request-capturing export clicks, so both stay.
8. **Upload ▾ is disabled while browsing history** (user answer 2026-10-17), with the same reason Download ▾ already shows there (`useExport().inputDisabledReason`, "Input exports reflect the current scenario"). Today Upload stayed enabled. `useEntityFileMenus` reads the reason from the export context, so no tab prop is needed; pinned by an RTL test (P4.1) and an e2e assertion (P4.3, `chen-bands-units-qa.spec.ts` history block).
9. **Table mode of the modal is its own branch** (`source: "table"`). The map flow (`source` omitted) is byte-identical; its existing test only switches its props type to the exported `MapCreateEntityDialogProps`. Table mode: lat/lng are text inputs with the inline forms' "touched" rule (gazetteer fill on City/State blur until the field is first focused, which clears it); the display code is **always** generated with `nextDisplayCode` (`lib/entityId.ts:49`) from City/State, known or unknown city (user answer 2026-10-17; the inline forms assigned one only on a gazetteer hit), and the student can still overwrite it, collision-checked when typed; warehouse/refinery show the status radio (default Potential); `capacity` is omitted (not `null`) when capacityMode is not `per_wh` (the map's convention). Tests that asserted the inline form's `capacity: null` / "no display code on a miss" are rewritten.
10. **`DemandCell` keeps an emptied field blank until blur.** `FormattedNumberInput` resyncs its text to the `value` prop on the next render whenever the parent did not adopt the emitted value; without a local "blank" flag, deleting the last digit of an added row's demand would immediately snap back mid-edit. Base rows: emptying clears the override (D3), the base value returns on blur. Added rows: nothing is saved, the last valid value returns on blur (user decision for added customers; applied by the same rule to added stations and JADE added per-product demand, which used to commit 0 / ignore the keystroke).
11. **`error-customer-demand-{id}` is removed.** `FormattedNumberInput` rejects invalid keystrokes, so there is no invalid state to report; no e2e references it (matrix §2c).
12. **Station demand shows a "tons" suffix** (user answer 2026-10-17); customers keep "Units". The suffix is a `DemandCell`/`FormattedNumberInput` prop value chosen by each adapter (and by the modal per kind), not a new global.
13. **The tab root testid is always present.** Warehouses/Refineries/Customers/Plants/Mines/Stations omitted `{entity}-tab` in the empty-dataset branch; the `DataTable` version always renders it (the empty text keeps `{entity}-tab-empty`).
14. **`enableFilters` stays** on Warehouses/Customers — it now only reaches `ImportDialog`'s preview grids (P3 removed it from OpenWarehouses, where it gated only the table).
15. **Auto-derived filters widen the menus** (spec B2.2): entity tables gain lat/lng (and zip/capacity/demand/status where present) filters; distance tables gain Base/Override/Distance/Cost ranges and a Leg select. Today's types are pinned where e2e or tests rely on them: `id`/`city`/`from`/`to` text, Warehouses `state` select (option value = state), Customers/Plants/Mines/Stations `state` text, warehouse `status` value = presentation label (`checkbox-filter-status-Fixed-Open`), JADE per-product keys `demand:{productId}`, Capability Matrix `plant` text + filter-only `state` select.
16. **`DataTable.distancesReplica.test.tsx` (P1.5) is deleted in SCU-2.P4.3.** It renders the real `DistancesTab` next to a test adapter and expects the real set *plus* a FilterMenu trigger; once the real tab is the DataTable, that expectation double-counts the trigger and the test fails by construction. Its job (proving the API before any consumer) is done; `DistancesTab.dataTable.test.tsx` replaces it with direct assertions.
17. **A D2 wiring guard** (`historyReadOnlyTabs.test.ts`, SCU-2.P4.1) scans every input-tab mount in `Workspace.tsx` for `readOnly={isBrowsingHistoryNow}` / `disabled={isBrowsingHistoryNow}`; each migration flips its tab from `"pending"` (which asserts the prop is still absent) to the prop it wires, and the last one asserts nothing is pending. It is the UI-side companion of the existing `historyReadOnlyGuards.test.ts` (write side). Like every syntactic guard it cannot see a mount that passes the flag through another name — the explicit allow-list is the mitigation (root gotcha on syntactic enumerations), and P4.15's browser pass is the behavioural check.
18. **The legacy table components stay.** `components/tables/{Warehouse,Customer,Mine,Station}Table.tsx` are still rendered by `pages/Studio.tsx`; the Workspace stops rendering them and keeps importing only their override types (unchanged).

## File Structure

| Path (under `artifacts/studio/`) | Change | Task |
|---|---|---|
| `src/components/data-table/DownloadMenu.tsx` | additive `label`, `children` | P4.1 |
| `src/components/data-table/ExpectedFieldsPanel.tsx` | **new** — panel + `requiredText`, `allowedText`, `expectedFields` | P4.1 |
| `src/components/data-table/useEntityFileMenus.tsx` | **new** — Upload ▾ / Download ▾ / dialog for one entity | P4.1 |
| `src/__tests__/entityFileMenus.test.tsx` | **new** | P4.1 |
| `src/__tests__/historyReadOnlyTabs.test.ts` | **new** D2 wiring guard (flipped per task) | P4.1 (+ P4.3–P4.14) |
| `src/__tests__/helpers/inputTable.ts` | **new** RTL helpers | P4.1 |
| `e2e/helpers/inputTable.ts` | **new** Playwright helpers | P4.1 |
| `docs/superpowers/plans/2026-10-17-scnd-upgrades-bundle2-matrix.md` (repo root) | references regenerated at `P3_TIP` | P4.1 |
| `src/components/workspace/map/dialogs/CreateEntityDialog.tsx` | `source: "table"` mode, `CreateEntitySubmit` | P4.2 |
| `src/__tests__/CreateEntityDialog.table.test.tsx` (**new**), `CreateEntityDialog.test.tsx` (props type) | | P4.2 |
| `src/components/workspace/tabs/{Distances,LegDistances,JadeDistances,LaneCosts,DeliveryCosts,TransportCosts,CapabilityMatrix}Tab.tsx` | rewritten onto DataTable | P4.3–P4.9 |
| `src/components/data-table/entityCells.tsx` | **new** (P4.10), `DemandCell` appended (P4.11) | P4.10, P4.11 |
| `src/components/workspace/tabs/{Warehouses,Customers,Plants,Mines,Stations}Tab.tsx` | rewritten onto DataTable + modal | P4.10–P4.14 |
| `src/__tests__/<Tab>.dataTable.test.tsx` | **new**, one per tab | P4.3–P4.14 |
| `src/__tests__/<Tab>.test.tsx`, `Workspace{,.Analytics,.Brazil,.Jade,.TransportCoal,.TwoEchelon}.test.tsx` | by-design rewrites | P4.2–P4.14 |
| `src/__tests__/DataTable.distancesReplica.test.tsx` | **deleted** (deviation 16) | P4.3 |
| `src/pages/Workspace.tsx` | history flag / `modelId` / delivery file props per mount | P4.3–P4.14 |
| `e2e/*.spec.ts` | rewrites from matrix §3 | P4.3, P4.5, P4.7, P4.10–P4.12 |
| `docs/CHANGELOG-implementation.md` (repo root) | one `### SCU-2.P4.N` per task | all |

## Interfaces

**Consumed — P1 (verbatim, `components/data-table/`):** `DataTable<T>(props: DataTableProps<T>)`; `ColumnDef<T>` (`id`, `header`, `filterLabel?`, `kind`, `cell(row, ctx)`, `value(row)`, `filter?: false | "text" | "select" | "range"`, `cellTestId?`, `headerTestId?`, `cellClassName?`, `hidden?`, `filterResetKey?`); `DataTableContext<T>` (**required** `readOnly`, `demandEditable`; optional `isOverridden`/`isChanged`/`isAdded`); `DataTableTestIds<T>` (`root`, `toolbar`, `table`, `scroll`, `count`, `row`, `pager`, `pagerPrev`, `pagerNext`, `pageIndicator`, `filterTrigger`, `empty`, `noMatch`); `DataTableToolbar` (`upload`, `download`, `add`, `extra`); `DataTableSection<T>` (`id`, `title`, `testId`, `tableTestId`, `scrollTestId`, `scrollClassName`, `rowTestId`, `includes`, `columns`, `footer`, `emptyState`); `DataTableFocus<T>` (`token`, `matches`); `FormattedNumberInput` (`value: number | null`, `onChange(number | null)`, `suffix?`, `integer?`, pass-through input props, no aria-label added); `EMPTY_FILTER_VALUE`; adapter rules (cell output directly in the `<td>`, omitted testid = no attribute, toolbar order upload → download → add → extra → count/filter).
**Consumed — P2:** `@workspace/import-schema`: `IMPORT_SCHEMAS`, `ImportEntity` (incl. `deliveryCosts`), `ImportFieldDescriptor`, `exampleCsv(entity)`, `exampleJsonDocument(entity)`; `ImportDialog` props `{ open, onOpenChange, scenarioId, entity: ImportEntity, format?: "csv" | "json", onApplied?, enableFilters? }` (its 2 MB wire guard and 413 text are P2's); `ExportEntity` and `INPUT_ENTITIES` include `"deliveryCosts"`.
**Consumed — P3:** `DownloadMenu({ testId, itemTestIds: Record<"csv" | "json", string>, onDownload(format), disabledReason? })`, `DownloadFormat`; `chooseDownload(trigger, item)` (`__tests__/helpers/downloadMenu.ts`).

**Produced (P4):**

```ts
// components/data-table/DownloadMenu.tsx (P3's, additive)
export interface DownloadMenuProps { /* …P3… */ label?: string /* default "Download" */; children?: ReactNode /* under the items */ }

// components/data-table/ExpectedFieldsPanel.tsx
export function requiredText(f: ImportFieldDescriptor): "always" | "add rows" | "update rows" | "optional";
export function allowedText(f: ImportFieldDescriptor): string;
export function expectedFields(entity: ImportEntity, modelId?: string): readonly ImportFieldDescriptor[];
export function ExpectedFieldsPanel(props: { entity: ImportEntity; modelId?: string }): JSX.Element; // <details data-testid="expected-fields-{entity}">

// components/data-table/useEntityFileMenus.tsx
export type FileEntity = Extract<ImportEntity, ExportEntity>;
export interface EntityFileMenusOptions { entity: FileEntity; testIdEntity: string; modelId?: string; scenarioId?: number; onImportApplied?: (s: Scenario) => void; enableFilters?: boolean }
export function useEntityFileMenus(o: EntityFileMenusOptions): { upload: ReactNode; download: ReactNode; dialog: ReactNode };

// components/workspace/map/dialogs/CreateEntityDialog.tsx
export type CreateEntityKind = "warehouse" | "customer" | "plant" | "mine" | "station" | "refinery";
export type CreateEntitySubmit =
  | { kind: "warehouse" | "refinery"; entity: AddedWarehouseInput } // (two members in the source)
  | { kind: "customer"; entity: AddedCustomerInput & { demands?: Record<string, number> } }
  | { kind: "plant"; entity: AddedPlantInput } | { kind: "mine"; entity: AddedMineInput } | { kind: "station"; entity: AddedStationInput };
export interface MapCreateEntityDialogProps { source?: "map"; /* …today's props, unchanged… */ }
export type CreateEntityDialogProps = MapCreateEntityDialogProps | { source: "table"; entityKind: CreateEntityKind; capacityMode?; hasStateColumn?; products?; existingCodes; onCreate(r: CreateEntitySubmit); onCancel() };

// components/data-table/entityCells.tsx
export const READ_ONLY_TITLE = "Read-only while browsing result history.";
export function StatusToggle<S extends string>(p: { options; value; labelOf; activeClassOf; onChange; disabled; testIdOf }): JSX.Element;
export function DeleteRowButton(p: { label; onClick; disabled; testId }): JSX.Element;
export function DraftNumberInput(p: { value; parse(raw): number | null; onCommit; disabled; placeholder?; testId }): JSX.Element;
export function DemandCell(p: { value: number | null; onCommit(v: number | null); clearCommits: boolean; suffix: string /* "Units" | "tons" */; integer?; disabled; title?; placeholder?; testId }): JSX.Element; // P4.11

// tab props (additive): DistancesTab / LegDistancesTab / JadeDistancesTab / LaneCostsTab / CapabilityMatrixTab /
// PlantsTab / MinesTab / StationsTab: readOnly?: boolean; DeliveryCostsTab: scenarioId?, onImportApplied?, readOnly?;
// WarehousesTab / CustomersTab: modelId?: string (history keeps the existing `disabled`).
```

```ts
// __tests__/helpers/inputTable.ts (RTL)
export function openFilterMenu(triggerTestId?: string): void;
export function filterText(key: string, value: string): void;
export function filterSelect(key: string, value: string): void;
export function chooseUpload(t: string, format?: "csv" | "json"): void;       // button-import-{t} → button-import-{t}-{format}
export function chooseInputDownload(t: string, format?: "csv" | "json"): void; // button-download-{t} → button-export-{t}-{format}
// e2e/helpers/inputTable.ts (Playwright)
export async function fillTableFilter(page: Page, key: string, value: string): Promise<void>;
export async function closePopover(page: Page): Promise<void>;
export async function chooseMenuItem(page: Page, triggerTestId: string, itemTestId: string): Promise<void>;
export async function readGroupedNumber(input: Locator): Promise<number>;
export function grouped(n: number): string;
```

## Testid map changes (all tables; everything else in matrix §2b/§2c is emitted unchanged)

| Old | New |
|---|---|
| `input-filter-from` / `input-filter-to` boxes (Distances, LegDistances, LaneCosts, DeliveryCosts) | the same ids, on the FilterMenu's text controls inside the popover (open `button-filter-menu-trigger` first) |
| `button-export-{t}-csv` / `-json` buttons | the same ids on the Download ▾ **menu items**; new trigger `button-download-{t}` |
| `button-import-{t}` button (opened ImportDialog) | the Upload ▾ **trigger**; new items `button-import-{t}-csv` / `-json` |
| (none on Delivery Costs) | `button-import-deliverycosts`, `button-import-deliverycosts-csv/json`, `button-download-deliverycosts`, `button-export-deliverycosts-csv/json` |
| `{x}-page-indicator`, `button-{x}-prev/next` (always on) | rendered only above 50 filtered rows; new pager ids on tables that never had one: `legdistances-*`, `lanecosts-*`, `{entity}-*` for Warehouses/Refineries/Customers/Plants/Mines/Stations |
| `add-{e}-row-form`, `input-new-{e}-{city,state,lat,lng,display-code,capacity,demand}`, `input-new-customer-demand-{p}`, `button-add-{e}-confirm/cancel`, `text-add-{e}-error` (six entities) | `create-entity-dialog`, `create-entity-{city,state,lat,lng,display-code,capacity,demand}`, `create-entity-demand-{p}`, `create-entity-submit/cancel`, `create-entity-error` |
| `error-customer-demand-{id}` | removed (deviation 11) |
| (new) | `expected-fields-{entity}`, `expected-field-{entity}-{csv_header}`, `expected-fields-{entity}-csv/json` |
| `{entity}-tab` absent in the empty-dataset branch | always present (deviation 13) |

## Execution topology

Strictly sequential: **P4.1 → P4.2 → P4.3 → … → P4.14 → P4.15 → P4.16.** Every migration edits `pages/Workspace.tsx` and the D2 guard, several share e2e spec files (`chen-bands-units-qa`, `max-coverage`, `jade-two-echelon`, `workspace-fixups-2`), and each runs the local two-server e2e recipe, which does not tolerate parallel runs on one machine (root flake gotcha). Do **not** rely on `isolation: "worktree"`. For each task the controller pre-creates a locked worktree from the current bundle tip:

```bash
BASE=$(git -C /Users/shubhamkr/nos-scnd-upgrades rev-parse scnd-upgrades)
git -C /Users/shubhamkr/nos-scnd-upgrades worktree add --lock /Users/shubhamkr/nos-scu-2.p4.N -b scu-2.p4.N-work "$BASE"
```

and dispatches without `isolation`. The agent's first Bash command is `cd /Users/shubhamkr/nos-scu-2.p4.N && git rev-parse --abbrev-ref HEAD` (must print `scu-2.p4.N-work`), then the base guards, each alone, plus `git merge-base --is-ancestor "$BASE" HEAD || exit 1`. The controller cherry-picks the task commit onto `scnd-upgrades`, re-runs the gate there, then creates the next worktree. A stalled agent with uncommitted work is resumed with `SendMessage`, not re-dispatched (root gotcha).

## Verification at plan time (what was actually run)

A scratch copy of `artifacts/studio` at `46d2f98` with the P1 plan's code applied (the P1 author's scratch), P3's `DownloadMenu.tsx` + `chooseDownload`, and P2's `@workspace/import-schema` source (with `deliveryCosts`) aliased in, `ImportDialog` given P2's `format` prop as a type stub and `ExportEntity`/`INPUT_ENTITIES` given `deliveryCosts`. Every code block and edit script below was produced from, and applied back onto, that copy:
- `tsc -p tsconfig.json --noEmit` exit 0 **after every task, applied in task order** (a step checker replayed P4.1 → P4.14's operations one task at a time and ran tsc plus that task's touched test files after each); the replayed end state equals the hand-built implementation byte for byte except the position of two `readOnly=` props.
- Full studio vitest on the end state (scratch with a fake repo root so the manifest-scanning tests resolve): **149 files, 2,575 tests, all passing** (re-run after the 2026-10-17 answers); `tsc --noEmit` exit 0.
- Every new `*.dataTable.test.tsx` was run against the **pre-migration** tab and fails there (counts quoted in each task's "verify it fails" step), so none is vacuous.
- The plan's own code blocks (every `cat > … <<'SCU_EOF'` and every edit script, in document order) were executed against a fresh baseline copy; the result equals the scratch implementation byte for byte (apart from the two `readOnly=` prop positions) for `src/` and the Bundle 1 tip `e2e/` tree.
- Every Workspace.tsx / `Workspace.test.tsx` / `Workspace.Jade.test.tsx` anchor was also checked to occur exactly once in the **Bundle 1 tip** (`scnd-upgrades-b1`) versions of those files, and every e2e edit was applied to the Bundle 1 tip `e2e/` tree and type-checked (`tsc`, exit 0 apart from the pre-existing `sidebar-rail.spec.ts` dom.iterable error in the scratch config).
- After the 2026-10-17 answers and the P1/P3 revisions (`downloadAlign`, P3.7's `descriptors.length > 0` filter condition, both mirrored into the scratch `DataTable`), the per-task replay, fail-first check and plan-block replay were re-run: unchanged results, P4.1 now 21 tests.
- Not run at plan time: Playwright (needs the two local servers and the real P1–P3 code), api-server tests, pytest, Docker. Each task runs them.
- Deliberate breaks (non-vacuity) measured: P4.1 Step 5; the D2 guard flip (`DistancesTab: "disabled"` → 1 failed / 12 passed).

---

## Task SCU-2.P4.1: Shared input-table toolbar (Upload ▾ / Download ▾ / expected fields), test helpers, D2 wiring guard, matrix refresh

**Owner role:** frontend-engineer. **Spec:** B2.3, B2.4, D2, B2.10. **Deviations:** 7, 8, 17.

**Why first and alone:** every input table needs the same three toolbar pieces; P3 already built the Download ▾ control (`DownloadMenu`), so P4 reuses it rather than writing a second menu (Upload ▾ is the same control with a different label and a different action). Like P1, this task has **no consumers**: no tab changes, so no rendered testid or text changes and no e2e rewrite. The guard test pins today's history wiring before any table moves.

**Files:**
- Modify: `artifacts/studio/src/components/data-table/DownloadMenu.tsx` (P3's — additive `label`, `children`)
- Create: `artifacts/studio/src/components/data-table/ExpectedFieldsPanel.tsx`, `artifacts/studio/src/components/data-table/useEntityFileMenus.tsx`
- Create: `artifacts/studio/src/__tests__/entityFileMenus.test.tsx`, `artifacts/studio/src/__tests__/historyReadOnlyTabs.test.ts`, `artifacts/studio/src/__tests__/helpers/inputTable.ts`, `artifacts/studio/e2e/helpers/inputTable.ts`
- Modify + commit: `docs/superpowers/plans/2026-10-17-scnd-upgrades-bundle2-matrix.md` (references regenerated `B1_TIP` → `P3_TIP`)
- Modify: `docs/CHANGELOG-implementation.md` (append `### SCU-2.P4.1`)

**Interfaces:**
- Consumes: P3 `DownloadMenu`/`DownloadFormat`; P2 `IMPORT_SCHEMAS`, `exampleCsv`, `exampleJsonDocument`, `ImportEntity`, `ImportFieldDescriptor`, `ImportDialog` (`format`); `useExport()`; `ExportEntity`; `AllProviders` / `ExportProviderTestWrapper` (`__tests__/helpers/renderWithExportProvider.tsx`).
- Produces: `DownloadMenu` `label?`/`children?`; `ExpectedFieldsPanel`, `requiredText`, `allowedText`, `expectedFields`; `useEntityFileMenus`, `FileEntity`, `EntityFileMenusOptions`; RTL `openFilterMenu`, `filterText`, `filterSelect`, `chooseUpload`, `chooseInputDownload`; Playwright `fillTableFilter`, `closePopover`, `chooseMenuItem`, `readGroupedNumber`, `grouped`; `historyReadOnlyTabs.test.ts` with three tabs wired (`WarehousesTab` ×2 and `CustomersTab` and `TransportCostsTab`: `disabled`) and nine `"pending"`.

- [ ] **Step 0: Invoke the simplicity skills**

Skill tool: `andrej-karpathy-skills:karpathy-guidelines`, then `ponytail:ponytail`. Record in the report that both ran (hard rule #12).

- [ ] **Step 1: Preconditions**

Run each line alone (worktree root):
```bash
cd /Users/shubhamkr/nos-scu-2.p4.1 && git rev-parse --abbrev-ref HEAD
git merge-base --is-ancestor "$BASE" HEAD || exit 1
git merge-base --is-ancestor "$B1_TIP" HEAD || exit 1
git merge-base --is-ancestor "$P3_TIP" HEAD || exit 1
test -f artifacts/studio/src/components/data-table/DataTable.tsx && test -f artifacts/studio/src/components/data-table/DownloadMenu.tsx && test -d lib/import-schema || exit 1
pnpm install --frozen-lockfile
```

- [ ] **Step 2: Refresh the migration matrix at `P3_TIP` (P1.1's scripts)**

P3 edited the output tabs and `Workspace.tsx`, so matrix line references written at `B1_TIP` have moved. Extract P1.1's three scripts verbatim from the P1 plan and re-run them (`git diff -U0 B1_TIP P3_TIP` drives the remap):
```bash
TMP=$(mktemp -d)
python3 - "$TMP" <<'PY'
import re, sys, pathlib
plan = pathlib.Path("docs/superpowers/plans/2026-10-17-scnd-upgrades-bundle2-p1.md").read_text()
for name in ("scu-remap.py", "scu-check.py", "scu-inv.py"):
    m = re.search(r"Write this script to `\$TMPDIR/" + re.escape(name) + r"`:\n\n```python\n(.*?)\n```", plan, re.S)
    assert m, name
    pathlib.Path(sys.argv[1], name).write_text(m.group(1) + "\n")
print("extracted 3 scripts")
PY
M=docs/superpowers/plans/2026-10-17-scnd-upgrades-bundle2-matrix.md
python3 $TMP/scu-remap.py $M "$B1_TIP" "$P3_TIP" > $TMP/matrix.new.md 2> $TMP/remap-report.txt && mv $TMP/matrix.new.md $M
python3 $TMP/scu-check.py $M "$P3_TIP" ; echo "check exit $?"
python3 $TMP/scu-inv.py $M artifacts/studio/e2e > $TMP/inv.md && grep -c '^#### ' $TMP/inv.md
```
If the extraction asserts (P1's wording changed), copy the three scripts from P1 Task SCU-2.P1.1 Steps 2–5 by hand. Re-locate every reference `remap-report.txt` lists by its quoted text. `scu-check.py` must report only the legitimate kinds P1.1 lists (FilterMenu mount lines, `idPrefix` template lines, abbreviated `…` testids). Replace §3's body (first `#### ` line up to the line before `## 4.`) with `$TMP/inv.md` (`30` groups expected). Update the provenance line to "… regenerated at `<B1_TIP short>` by SCU-2.P1.1 and at `<P3_TIP short>` by SCU-2.P4.1". The P4 rows (#10–#30) and §2b/§2c testid maps describe the input tabs, which neither Bundle 1 nor P1–P3 edit, so their file:line values must come out unchanged — any change there is a STOP (someone touched an input tab).

- [ ] **Step 3: Extend P3's `DownloadMenu` (additive)**

```bash
python3 - <<'PY'
import pathlib
EDITS = [
    ('artifacts/studio/src/components/data-table/DownloadMenu.tsx',
     '''// tooltip, exactly as the single Download CSV buttons it replaces did.

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";''',
     '''// tooltip, exactly as the single Download CSV buttons it replaces did.

import { useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";'''),
    ('artifacts/studio/src/components/data-table/DownloadMenu.tsx',
     '''  /** Non-null disables the trigger; shown as its title. */
  disabledReason?: string;
}
''',
     '''  /** Non-null disables the trigger; shown as its title. */
  disabledReason?: string;
  /** SCU-2.P4.1 — trigger text. Default "Download"; the input tables' Upload ▾ passes "Upload". */
  label?: string;
  /** SCU-2.P4.1 — rendered under the items (the input tables' expected-fields panel). */
  children?: ReactNode;
}
'''),
    ('artifacts/studio/src/components/data-table/DownloadMenu.tsx',
     '''];

export function DownloadMenu({ testId, itemTestIds, onDownload, disabledReason }: DownloadMenuProps) {
  const [open, setOpen] = useState(false);
  return (''',
     '''];

export function DownloadMenu({ testId, itemTestIds, onDownload, disabledReason, label = "Download", children }: DownloadMenuProps) {
  const [open, setOpen] = useState(false);
  return ('''),
    ('artifacts/studio/src/components/data-table/DownloadMenu.tsx',
     '''          title={disabledReason}
        >
          Download
          <ChevronDown className="w-3.5 h-3.5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-32 p-1" align="end" role="menu">
        {ITEMS.map(({ format, label }) => (
          <button
            key={format}''',
     '''          title={disabledReason}
        >
          {label}
          <ChevronDown className="w-3.5 h-3.5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className={children ? "w-[30rem] max-w-[90vw] p-1" : "w-32 p-1"} align="end" role="menu">
        {ITEMS.map(({ format, label: itemLabel }) => (
          <button
            key={format}'''),
    ('artifacts/studio/src/components/data-table/DownloadMenu.tsx',
     '''            }}
          >
            {label}
          </button>
        ))}
      </PopoverContent>
    </Popover>''',
     '''            }}
          >
            {itemLabel}
          </button>
        ))}
        {children && <div className="mt-1 border-t pt-1">{children}</div>}
      </PopoverContent>
    </Popover>'''),
]
for path, old, new in EDITS:
    f = pathlib.Path(path)
    s = f.read_text()
    n = s.count(old)
    if n != 1:
        raise SystemExit(f'STOP: {path}: anchor found {n} times (expected 1): {old[:80]!r}')
    f.write_text(s.replace(old, new, 1))
print(f'applied {len(EDITS)} edits')
PY
```

Run: `pnpm --filter studio exec vitest run src/__tests__/DownloadMenu.test.tsx` → PASS, unchanged count (P3's tests; defaults keep its behaviour).

- [ ] **Step 4: Write the failing tests and the helpers they use**

Create `artifacts/studio/src/__tests__/helpers/inputTable.ts`:

```bash
mkdir -p artifacts/studio/src/__tests__/helpers && cat > artifacts/studio/src/__tests__/helpers/inputTable.ts <<'SCU_EOF'
// SCU-2.P4.1 — RTL helpers shared by the migrated input-table tests (P4).
// The From/To boxes became FilterMenu controls (B2.2) and the Upload /
// Download buttons became menus (B2.3/B2.4), so a test now opens the menu
// first. `within` scopes to one tab when two filter triggers are on screen.
import { fireEvent, screen } from "@testing-library/react";

/** Opens the (single) FilterMenu if it is not open yet. */
export function openFilterMenu(triggerTestId = "button-filter-menu-trigger"): void {
  if (!screen.queryByTestId("filter-menu-popover")) fireEvent.click(screen.getByTestId(triggerTestId));
}

/** Types into a FilterMenu text control (`input-filter-{key}`). */
export function filterText(key: string, value: string): void {
  openFilterMenu();
  fireEvent.change(screen.getByTestId(`input-filter-${key}`), { target: { value } });
}

/** Ticks a FilterMenu select option (`checkbox-filter-{key}-{value}`). */
export function filterSelect(key: string, value: string): void {
  openFilterMenu();
  fireEvent.click(screen.getByTestId(`checkbox-filter-${key}-${value}`));
}

/** Upload ▾ → CSV/JSON (`button-import-{t}` then `button-import-{t}-{format}`). */
export function chooseUpload(t: string, format: "csv" | "json" = "csv"): void {
  fireEvent.click(screen.getByTestId(`button-import-${t}`));
  fireEvent.click(screen.getByTestId(`button-import-${t}-${format}`));
}

/** Download ▾ → CSV/JSON (`button-download-{t}` then `button-export-{t}-{format}`). */
export function chooseInputDownload(t: string, format: "csv" | "json" = "csv"): void {
  fireEvent.click(screen.getByTestId(`button-download-${t}`));
  fireEvent.click(screen.getByTestId(`button-export-${t}-${format}`));
}
SCU_EOF
```

Create `artifacts/studio/src/__tests__/entityFileMenus.test.tsx`:

```bash
mkdir -p artifacts/studio/src/__tests__ && cat > artifacts/studio/src/__tests__/entityFileMenus.test.tsx <<'SCU_EOF'
// SCU-2.P4.1 — Upload ▾ / Download ▾ / expected-fields panel for input tables
// (spec B2.3, B2.4). ImportDialog and the export fetch are mocked: their own
// behaviour is covered by ImportDialog.test.tsx / ExportContext.test.tsx; this
// file pins the literal testids, the format each item hands on, and that the
// panel is derived from @workspace/import-schema.

import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { IMPORT_SCHEMAS, exampleCsv, exampleJsonDocument } from "@workspace/import-schema";
import { AllProviders, ExportProviderTestWrapper } from "@/__tests__/helpers/renderWithExportProvider";
import { UnitProvider } from "@/contexts/UnitContext";
import { useEntityFileMenus, type EntityFileMenusOptions } from "@/components/data-table/useEntityFileMenus";
import { allowedText, expectedFields, requiredText } from "@/components/data-table/ExpectedFieldsPanel";

const downloadEntityExport = vi.fn();
vi.mock("@/lib/exportEntity", () => ({
  downloadEntityExport: (...args: unknown[]) => downloadEntityExport(...args),
}));
vi.mock("@/components/ImportDialog", () => ({
  ImportDialog: (p: { entity: string; format: string; scenarioId: number; enableFilters?: boolean; onOpenChange: (o: boolean) => void }) => (
    <div data-testid="stub-import-dialog" data-entity={p.entity} data-format={p.format} data-scenario={p.scenarioId} data-filters={String(!!p.enableFilters)}>
      <button type="button" data-testid="stub-import-close" onClick={() => p.onOpenChange(false)} />
    </div>
  ),
}));

function Harness(props: EntityFileMenusOptions) {
  const m = useEntityFileMenus(props);
  return (
    <div>
      {m.upload}
      {m.download}
      {m.dialog}
    </div>
  );
}

beforeEach(() => downloadEntityExport.mockReset());

describe("useEntityFileMenus (SCU-2.P4.1)", () => {
  it("emits the literal Upload/Download testids and keeps today's export ids on the items", () => {
    render(<Harness entity="legDistances" testIdEntity="legdistances" scenarioId={7} />, { wrapper: AllProviders });
    expect(screen.getByTestId("button-import-legdistances")).toHaveTextContent("Upload");
    expect(screen.getByTestId("button-download-legdistances")).toHaveTextContent("Download");
    fireEvent.click(screen.getByTestId("button-download-legdistances"));
    expect(screen.getByTestId("button-export-legdistances-csv")).toHaveTextContent("CSV");
    expect(screen.getByTestId("button-export-legdistances-json")).toHaveTextContent("JSON");
  });

  it("Download items call the server export with the chosen format", () => {
    render(<Harness entity="distances" testIdEntity="distances" scenarioId={7} />, { wrapper: AllProviders });
    fireEvent.click(screen.getByTestId("button-download-distances"));
    fireEvent.click(screen.getByTestId("button-export-distances-json"));
    expect(downloadEntityExport).toHaveBeenCalledWith(1, "distances", "json", { unit: "mi", runId: undefined });
    fireEvent.click(screen.getByTestId("button-download-distances"));
    fireEvent.click(screen.getByTestId("button-export-distances-csv"));
    expect(downloadEntityExport).toHaveBeenLastCalledWith(1, "distances", "csv", { unit: "mi", runId: undefined });
  });

  it("Upload items open ImportDialog with the chosen format; closing unmounts it", () => {
    render(<Harness entity="deliveryCosts" testIdEntity="deliverycosts" scenarioId={7} enableFilters />, { wrapper: AllProviders });
    expect(screen.queryByTestId("stub-import-dialog")).toBeNull();
    fireEvent.click(screen.getByTestId("button-import-deliverycosts"));
    fireEvent.click(screen.getByTestId("button-import-deliverycosts-json"));
    const dialog = screen.getByTestId("stub-import-dialog");
    expect(dialog).toHaveAttribute("data-entity", "deliveryCosts");
    expect(dialog).toHaveAttribute("data-format", "json");
    expect(dialog).toHaveAttribute("data-scenario", "7");
    expect(dialog).toHaveAttribute("data-filters", "true");
    fireEvent.click(screen.getByTestId("stub-import-close"));
    expect(screen.queryByTestId("stub-import-dialog")).toBeNull();
    fireEvent.click(screen.getByTestId("button-import-deliverycosts"));
    fireEvent.click(screen.getByTestId("button-import-deliverycosts-csv"));
    expect(screen.getByTestId("stub-import-dialog")).toHaveAttribute("data-format", "csv");
  });

  it("Upload is disabled until the scenario resolves; Download carries the provider's disabled reason", () => {
    render(
      <UnitProvider>
        <ExportProviderTestWrapper value={{ inputDisabledReason: "Input exports reflect the current scenario" }}>
          <Harness entity="customers" testIdEntity="customers" />
        </ExportProviderTestWrapper>
      </UnitProvider>,
    );
    expect(screen.getByTestId("button-import-customers")).toBeDisabled();
    expect(screen.getByTestId("button-download-customers")).toBeDisabled();
    expect(screen.getByTestId("button-download-customers")).toHaveAttribute("title", "Input exports reflect the current scenario");
  });

  it("while browsing history BOTH menus are disabled with the Download reason (user decision 2026-10-17)", () => {
    render(
      <UnitProvider>
        <ExportProviderTestWrapper value={{ inputDisabledReason: "Input exports reflect the current scenario" }}>
          <Harness entity="distances" testIdEntity="distances" scenarioId={7} />
        </ExportProviderTestWrapper>
      </UnitProvider>,
    );
    for (const id of ["button-import-distances", "button-download-distances"]) {
      expect(screen.getByTestId(id)).toBeDisabled();
      expect(screen.getByTestId(id)).toHaveAttribute("title", "Input exports reflect the current scenario");
    }
  });

  it("both menus show the expected-fields panel built from @workspace/import-schema", () => {
    render(<Harness entity="warehouses" testIdEntity="warehouses" modelId="p-median-us" scenarioId={7} />, { wrapper: AllProviders });
    for (const trigger of ["button-import-warehouses", "button-download-warehouses"]) {
      fireEvent.click(screen.getByTestId(trigger));
      const panel = screen.getByTestId("expected-fields-warehouses");
      const headers = within(panel).getAllByTestId(/^expected-field-warehouses-/).map(r => r.getAttribute("data-testid"));
      expect(headers).toEqual(IMPORT_SCHEMAS.warehouses.versions[0]!.fields.map(f => `expected-field-warehouses-${f.csvHeader}`));
      expect(within(panel).getByTestId("expected-fields-warehouses-csv").textContent).toBe(exampleCsv("warehouses"));
      expect(JSON.parse(within(panel).getByTestId("expected-fields-warehouses-json").textContent ?? "")).toEqual(exampleJsonDocument("warehouses"));
      expect(within(panel).getByText("Leave id blank to add a new row.")).toBeInTheDocument();
      fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    }
  });
});

describe("expected-fields text (SCU-2.P4.1)", () => {
  it("drops fields that do not apply to the model (warehouse capacity is p-median only)", () => {
    expect(expectedFields("warehouses", "p-median-us").map(f => f.csvHeader)).toContain("capacity");
    expect(expectedFields("warehouses", "delivery-teaching-us").map(f => f.csvHeader)).not.toContain("capacity");
    expect(expectedFields("warehouses").map(f => f.csvHeader)).toContain("capacity");
  });

  it("describes required-ness, enums, bounds and the unit column", () => {
    const byHeader = (entity: "warehouses" | "distances" | "deliveryCosts", h: string) =>
      expectedFields(entity).find(f => f.csvHeader === h)!;
    expect(requiredText(byHeader("warehouses", "id"))).toBe("update rows");
    expect(requiredText(byHeader("warehouses", "city"))).toBe("add rows");
    expect(requiredText(byHeader("warehouses", "status"))).toBe("always");
    expect(requiredText(byHeader("warehouses", "display_code"))).toBe("optional");
    expect(allowedText(byHeader("warehouses", "status"))).toBe("active | forced_open | inactive");
    expect(allowedText(byHeader("distances", "distance"))).toBe("> 0; in the file's unit");
    expect(allowedText(byHeader("distances", "unit"))).toBe("km | mi; JSON: may come from the envelope's unit");
    expect(allowedText(byHeader("deliveryCosts", "cost"))).toBe("≥ 0");
  });
});
SCU_EOF
```

Create `artifacts/studio/src/__tests__/historyReadOnlyTabs.test.ts`:

```bash
mkdir -p artifacts/studio/src/__tests__ && cat > artifacts/studio/src/__tests__/historyReadOnlyTabs.test.ts <<'SCU_EOF'
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// SCU-2.P4.1 (spec D2) — the UI half of "history is read-only". The write
// half is pinned by historyReadOnlyGuards.test.ts (every mutator no-ops while
// browsing history), but that only makes a stale edit SILENT: the input still
// looks editable and the keystroke vanishes. D2 makes every editable cell in
// every input tab visibly disabled, which needs each tab mount in
// Workspace.tsx to pass the live history flag. This scans every mount, so a
// table that forgets the prop — or a new mount of a listed tab — fails here.
//
// Each P4 migration task flips its tab from "pending" to the prop it wires;
// "pending" also asserts the prop is still ABSENT, so the flip is a
// deliberate, reviewed edit. The last migration (SCU-2.P4.14) adds the
// assertion that nothing is left pending.
const WORKSPACE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../pages/Workspace.tsx");

const INPUT_TAB_HISTORY_PROP: Record<string, "readOnly" | "disabled" | "pending"> = {
  WarehousesTab: "disabled", // warehouses + refineries mounts (pre-existing)
  CustomersTab: "disabled", // pre-existing
  TransportCostsTab: "disabled", // pre-existing
  DistancesTab: "pending", // SCU-2.P4.3
  LegDistancesTab: "pending", // SCU-2.P4.4
  JadeDistancesTab: "pending", // SCU-2.P4.5
  LaneCostsTab: "pending", // SCU-2.P4.6
  DeliveryCostsTab: "pending", // SCU-2.P4.7
  CapabilityMatrixTab: "pending", // SCU-2.P4.9
  PlantsTab: "pending", // SCU-2.P4.12
  MinesTab: "pending", // SCU-2.P4.13
  StationsTab: "pending", // SCU-2.P4.14
};

/** Every `<Name … />` mount's prop text (from the tag to its own `/>` line). */
function mounts(src: string, name: string): string[] {
  const out: string[] = [];
  const re = new RegExp(`<${name}\\b`, "g");
  for (let m = re.exec(src); m; m = re.exec(src)) {
    const end = src.indexOf("\n", src.slice(m.index).search(/\n\s*\/>/) + m.index + 1);
    out.push(src.slice(m.index, end));
  }
  return out;
}

describe("Workspace — every input tab mount receives the history flag (D2)", () => {
  const src = fs.readFileSync(WORKSPACE, "utf8");

  it.each(Object.entries(INPUT_TAB_HISTORY_PROP))("%s → %s", (name, prop) => {
    const found = mounts(src, name);
    expect(found.length, `${name} is not mounted in Workspace.tsx`).toBeGreaterThan(0);
    for (const m of found) {
      if (prop === "pending") {
        expect(m).not.toMatch(/\b(readOnly|disabled)=\{isBrowsingHistoryNow\}/);
      } else {
        expect(m).toContain(`${prop}={isBrowsingHistoryNow}`);
      }
    }
  });

  it("the mount scanner is not vacuous: it finds both WarehousesTab mounts", () => {
    expect(mounts(src, "WarehousesTab")).toHaveLength(2);
    expect(mounts(src, "WarehousesTab").every(m => m.includes("onChange="))).toBe(true);
  });
});
SCU_EOF
```

Run: `pnpm --filter studio exec vitest run src/__tests__/entityFileMenus.test.tsx src/__tests__/historyReadOnlyTabs.test.ts`
Expected: `entityFileMenus.test.tsx` FAILS to resolve `@/components/data-table/useEntityFileMenus` / `ExpectedFieldsPanel`; `historyReadOnlyTabs.test.ts` PASSES (13 tests — it pins today's wiring: the three already-wired tabs pass `disabled`, the nine others pass nothing).

- [ ] **Step 5: Implement**

Create `artifacts/studio/src/components/data-table/ExpectedFieldsPanel.tsx`:

```bash
mkdir -p artifacts/studio/src/components/data-table && cat > artifacts/studio/src/components/data-table/ExpectedFieldsPanel.tsx <<'SCU_EOF'
// SCU-2.P4.1 (spec B2.3/B2.4) — the "expected fields" panel shown inside every
// input table's Upload ▾ and Download ▾ menu. Everything comes from
// @workspace/import-schema (the same descriptors the server imports with), so
// the panel cannot drift from what an upload actually accepts. A native
// <details> keeps it collapsed by default with no state of its own.

import {
  IMPORT_SCHEMAS,
  exampleCsv,
  exampleJsonDocument,
  type ImportEntity,
  type ImportFieldDescriptor,
} from "@workspace/import-schema";

/** "always" | "add rows" | "update rows" | "optional" — B2.3 "required (add vs update)". */
export function requiredText(f: ImportFieldDescriptor): string {
  if (f.requiredForAdd && f.requiredForUpdate) return "always";
  if (f.requiredForAdd) return "add rows";
  if (f.requiredForUpdate) return "update rows";
  return "optional";
}

/** Enum values, numeric bound and unit note — B2.3 "enum values, numeric bounds, unit". */
export function allowedText(f: ImportFieldDescriptor): string {
  const parts: string[] = [];
  if (f.enum) parts.push(f.enum.join(" | "));
  if (f.min !== undefined) parts.push(`${f.exclusiveMin ? ">" : "≥"} ${f.min}`);
  if (f.unitFamily === "distance") parts.push("in the file's unit");
  if (f.envelopeKey) parts.push(`JSON: may come from the envelope's ${f.envelopeKey}`);
  return parts.length ? parts.join("; ") : "—";
}

/** Fields of the version export emits (the last one), minus those that do not apply to `modelId`. */
export function expectedFields(entity: ImportEntity, modelId?: string): readonly ImportFieldDescriptor[] {
  const versions = IMPORT_SCHEMAS[entity].versions;
  const fields = versions[versions.length - 1]!.fields;
  return modelId ? fields.filter(f => !f.models || (f.models as readonly string[]).includes(modelId)) : fields;
}

export function ExpectedFieldsPanel({ entity, modelId }: { entity: ImportEntity; modelId?: string }) {
  const schema = IMPORT_SCHEMAS[entity];
  const canAdd = modelId ? (schema.addModels as readonly string[]).includes(modelId) : schema.addModels.length > 0;
  return (
    <details className="text-xs" data-testid={`expected-fields-${entity}`}>
      <summary className="cursor-pointer px-2 py-1 text-muted-foreground">Expected fields</summary>
      <div className="space-y-2 px-2 pb-2">
        <table className="w-full text-[11px]">
          <thead>
            <tr className="text-left text-muted-foreground">
              <th className="pr-2 font-medium">CSV column</th>
              <th className="pr-2 font-medium">JSON key</th>
              <th className="pr-2 font-medium">Type</th>
              <th className="pr-2 font-medium">Required</th>
              <th className="font-medium">Allowed</th>
            </tr>
          </thead>
          <tbody>
            {expectedFields(entity, modelId).map(f => (
              <tr key={f.csvHeader} data-testid={`expected-field-${entity}-${f.csvHeader}`}>
                <td className="pr-2 font-mono">{f.csvHeader}</td>
                <td className="pr-2 font-mono">{f.jsonKey}</td>
                <td className="pr-2">{f.type}</td>
                <td className="pr-2">{requiredText(f)}</td>
                <td>{allowedText(f)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {canAdd && <p className="text-muted-foreground">Leave id blank to add a new row.</p>}
        <p className="text-muted-foreground">Example CSV</p>
        <pre className="overflow-x-auto rounded bg-muted p-1 font-mono text-[10px]" data-testid={`expected-fields-${entity}-csv`}>
          {exampleCsv(entity)}
        </pre>
        <p className="text-muted-foreground">Example JSON</p>
        <pre className="overflow-x-auto rounded bg-muted p-1 font-mono text-[10px]" data-testid={`expected-fields-${entity}-json`}>
          {JSON.stringify(exampleJsonDocument(entity), null, 2)}
        </pre>
      </div>
    </details>
  );
}
SCU_EOF
```

Create `artifacts/studio/src/components/data-table/useEntityFileMenus.tsx`:

```bash
mkdir -p artifacts/studio/src/components/data-table && cat > artifacts/studio/src/components/data-table/useEntityFileMenus.tsx <<'SCU_EOF'
// SCU-2.P4.1 (spec B2.3/B2.4) — Upload ▾ and Download ▾ for one input entity,
// plus the ImportDialog they open. Every input table (B2.3's list) puts
// `upload` / `download` in its DataTable toolbar and renders `dialog` once.
// Testids are literal per table, keyed on the lowercase name the table's
// testids already use (`testIdEntity`, e.g. "legdistances"):
//   Upload trigger  button-import-{t}           (today's Upload button id, kept)
//   Upload items    button-import-{t}-csv|json  (new)
//   Download trigger button-download-{t}        (new; P3's output convention)
//   Download items  button-export-{t}-csv|json  (today's two button ids, kept)
// Both menus are disabled while browsing result history, with the same reason.

import { useState, type ReactNode } from "react";
import type { Scenario } from "@workspace/api-client-react";
import type { ImportEntity } from "@workspace/import-schema";
import { ImportDialog } from "@/components/ImportDialog";
import { useExport } from "@/contexts/ExportContext";
import type { ExportEntity } from "@/lib/exportEntity";
import { DownloadMenu, type DownloadFormat } from "./DownloadMenu";
import { ExpectedFieldsPanel } from "./ExpectedFieldsPanel";

export type FileEntity = Extract<ImportEntity, ExportEntity>;

export interface EntityFileMenusOptions {
  entity: FileEntity;
  /** The lowercase name in today's testids ("warehouses", "legdistances", "deliverycosts"). */
  testIdEntity: string;
  /** Narrows the expected-fields panel to the fields this model imports. */
  modelId?: string;
  /** Undefined until the scenario resolves — Upload stays disabled, as today (also disabled in history). */
  scenarioId?: number;
  onImportApplied?: (scenario: Scenario) => void;
  /** Threaded to ImportDialog's preview grids (JADE), as today. */
  enableFilters?: boolean;
}

export interface EntityFileMenus {
  upload: ReactNode;
  download: ReactNode;
  dialog: ReactNode;
}

export function useEntityFileMenus({
  entity,
  testIdEntity: t,
  modelId,
  scenarioId,
  onImportApplied,
  enableFilters,
}: EntityFileMenusOptions): EntityFileMenus {
  const { download, disabledReasonFor, inputDisabledReason } = useExport();
  const [importFormat, setImportFormat] = useState<DownloadFormat | null>(null);
  const panel = <ExpectedFieldsPanel entity={entity} modelId={modelId} />;

  const upload = (
    // DownloadMenu is the shared "one trigger, CSV + JSON items" control (P3);
    // here its chosen format opens the import dialog instead of downloading.
    <DownloadMenu
      label="Upload"
      testId={`button-import-${t}`}
      itemTestIds={{ csv: `button-import-${t}-csv`, json: `button-import-${t}-json` }}
      onDownload={setImportFormat}
      // History (user decision 2026-10-17): Upload is disabled with the same
      // reason Download shows (`inputDisabledReason`), not just the cells (D2).
      disabledReason={scenarioId == null ? "Loading…" : inputDisabledReason}
    >
      {panel}
    </DownloadMenu>
  );

  const downloadMenu = (
    <DownloadMenu
      testId={`button-download-${t}`}
      itemTestIds={{ csv: `button-export-${t}-csv`, json: `button-export-${t}-json` }}
      onDownload={format => void download(entity, format)}
      disabledReason={disabledReasonFor(entity)}
    >
      {panel}
    </DownloadMenu>
  );

  // Mounted only while open — ImportDialog runs its mutation hooks on render (as today).
  const dialog = importFormat != null && scenarioId != null && (
    <ImportDialog
      open
      onOpenChange={open => !open && setImportFormat(null)}
      scenarioId={scenarioId}
      entity={entity}
      format={importFormat}
      onApplied={onImportApplied}
      enableFilters={enableFilters}
    />
  );

  return { upload, download: downloadMenu, dialog };
}
SCU_EOF
```

Create `artifacts/studio/e2e/helpers/inputTable.ts`:

```bash
mkdir -p artifacts/studio/e2e/helpers && cat > artifacts/studio/e2e/helpers/inputTable.ts <<'SCU_EOF'
// SCU-2.P4.1 — Playwright helpers for the migrated input tables (Bundle 2 P4).
// The From/To boxes became FilterMenu text controls inside a popover (spec
// B2.2), Upload/Download became menus (B2.3/B2.4), and demand cells show
// grouped numbers (B2.9) — `Number("1,234")` is NaN, so read them here.
import { expect, type Locator, type Page } from "@playwright/test";

const TIMEOUT = 10_000;

/** Opens the active tab's FilterMenu (if closed) and types into `input-filter-{key}`. */
export async function fillTableFilter(page: Page, key: string, value: string): Promise<void> {
  const popover = page.getByTestId("filter-menu-popover");
  if (!(await popover.isVisible())) await page.getByTestId("button-filter-menu-trigger").click({ timeout: TIMEOUT });
  await expect(page.getByTestId(`input-filter-${key}`)).toBeVisible({ timeout: TIMEOUT });
  await page.getByTestId(`input-filter-${key}`).fill(value);
}

/** Closes an open FilterMenu / menu popover so it cannot cover the table. */
export async function closePopover(page: Page): Promise<void> {
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("filter-menu-popover")).toHaveCount(0, { timeout: TIMEOUT });
}

/** Opens a Download ▾ / Upload ▾ menu and clicks one item. */
export async function chooseMenuItem(page: Page, triggerTestId: string, itemTestId: string): Promise<void> {
  await page.getByTestId(triggerTestId).click({ timeout: TIMEOUT });
  await page.getByTestId(itemTestId).click({ timeout: TIMEOUT });
}

/** A grouped FormattedNumberInput value ("1,234.5") as a number. */
export async function readGroupedNumber(input: Locator): Promise<number> {
  return Number((await input.inputValue()).replace(/,/g, ""));
}

/** What a FormattedNumberInput shows for `n` (en-US grouping). */
export function grouped(n: number): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: 20 });
}
SCU_EOF
```

Run: `pnpm --filter studio exec vitest run src/__tests__/entityFileMenus.test.tsx src/__tests__/historyReadOnlyTabs.test.ts`
Expected: PASS — 21 tests in 2 files (measured at plan time). Then `pnpm --filter studio typecheck` and `pnpm --filter studio typecheck:e2e` → exit 0 (the e2e helper has no consumer yet but is type-checked).

- [ ] **Step 6: Deliberate breaks (non-vacuity — revert each)**

Measured at plan time:
1. In `useEntityFileMenus.tsx` change `` csv: `button-export-${t}-csv` `` to `` csv: `button-export-${t}-cvs` `` → `Tests  2 failed | 6 passed (8)` in `entityFileMenus.test.tsx` ("emits the literal Upload/Download testids …", "Download items call the server export …"). Revert.
2. In `ExpectedFieldsPanel.tsx` make `expectedFields` return `fields` unconditionally → `1 failed` ("drops fields that do not apply to the model …"). Revert.
3. In `historyReadOnlyTabs.test.ts` set `TransportCostsTab: "readOnly"` → `1 failed` (`TransportCostsTab → readOnly`: the mount passes `disabled`). Revert.
Re-run the Step 5 command → PASS.

- [ ] **Step 7: e2e sweep**

No tab renders the new pieces yet: `grep -rn 'useEntityFileMenus\|ExpectedFieldsPanel' artifacts/studio/src --include='*.tsx' | grep -v __tests__` → only the two new files. `DownloadMenu`'s defaults are unchanged, so P3's output tables render the same DOM. Record `e2e: n/a (no consumers)`.

- [ ] **Step 8: Gate**

Run each separately (Global Constraints):
1. `cnt=$(ps aux | grep "[v]itest" | grep -v "zsh -c" | wc -l | tr -d ' '); [ "$cnt" = "0" ]`
2. `pnpm run typecheck`
3. `pnpm --filter studio typecheck:e2e`
4. `DATABASE_URL="postgresql://shubhamkr@localhost:5432/nos_dev" pnpm --filter api-server test`
5. `pnpm --filter studio test`
6. `(cd artifacts/api-server/src/solver && python3 -m pytest tests/ -x)`
7. `pnpm --filter @workspace/import-schema test`

Expected: every command exits 0. Then `git diff --stat "$P3_TIP"..HEAD -- artifacts/api-server lib/db lib/api-spec` prints nothing.

- [ ] **Step 9: Changelog**

Append to the bottom of `docs/CHANGELOG-implementation.md`:

```markdown

### SCU-2.P4.1 — Shared input-table toolbar, helpers, D2 guard, matrix refresh

- `DownloadMenu` (P3) gains `label` + `children` (additive; defaults unchanged). New `ExpectedFieldsPanel` (from `@workspace/import-schema`: CSV header / JSON key / type / required add vs update / enum / bounds / unit / example CSV + JSON) and `useEntityFileMenus` (Upload ▾ `button-import-{t}` → `-csv|-json` opens ImportDialog with `format`, disabled in history with the Download reason; Download ▾ `button-download-{t}` → `button-export-{t}-csv|json`). No consumers yet.
- RTL helpers `__tests__/helpers/inputTable.ts`, Playwright helpers `e2e/helpers/inputTable.ts`.
- D2 wiring guard `historyReadOnlyTabs.test.ts`: 3 tabs wired (`disabled`), 9 pending.
- Matrix references regenerated `<B1_TIP short>` → `<P3_TIP short>`: <N> remapped, <K> re-located by quoted text; P4 rows unchanged.
- Deliberate breaks: 3 measured (testid, model filter, guard).
- Deviations 7, 8, 17.
- Gate: studio <N passed>, api-server <N passed>, pytest <N passed>, import-schema <N passed>. e2e (local, `E2E_BASE_URL` set): <spec: pass/fail per spec>.
```

Replace each `<…>` with the value measured in this run, or the literal `unknown`.

- [ ] **Step 10: Commit**

```bash
git add artifacts/studio/src/components/data-table/ExpectedFieldsPanel.tsx artifacts/studio/src/components/data-table/useEntityFileMenus.tsx artifacts/studio/src/__tests__/entityFileMenus.test.tsx artifacts/studio/src/__tests__/helpers/inputTable.ts artifacts/studio/src/__tests__/historyReadOnlyTabs.test.ts artifacts/studio/e2e/helpers/inputTable.ts
```

```bash
[ "$(git rev-parse --abbrev-ref HEAD)" != "main" ] || exit 1
```

```bash
git commit artifacts/studio/src/components/data-table/ExpectedFieldsPanel.tsx artifacts/studio/src/components/data-table/useEntityFileMenus.tsx artifacts/studio/src/__tests__/entityFileMenus.test.tsx artifacts/studio/src/__tests__/helpers/inputTable.ts artifacts/studio/src/__tests__/historyReadOnlyTabs.test.ts artifacts/studio/e2e/helpers/inputTable.ts artifacts/studio/src/components/data-table/DownloadMenu.tsx docs/superpowers/plans/2026-10-17-scnd-upgrades-bundle2-matrix.md docs/CHANGELOG-implementation.md -m "[SCU-2.P4.1] add shared input-table toolbar menus, helpers and D2 wiring guard" -m "Upload/Download menus (P3 DownloadMenu reused, additive label/children), expected-fields panel from @workspace/import-schema, RTL + Playwright helpers, history-flag wiring guard; matrix refs regenerated at P3_TIP. No consumers. Deviations 7, 8, 17." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task SCU-2.P4.2: `CreateEntityDialog` table mode — the "+ Add {Entity}" modal (B2.8, B2.9 add-form rule)

**Owner role:** frontend-engineer. **Spec:** B2.8; B2.9 ("the add-customer form … blocks submit when a demand field is empty"); user decisions 2026-10-17 (modal lat/lng editable from a table, JADE per-product blank no longer 0). **Deviations:** 2, 9.

**Files:**
- Modify: `artifacts/studio/src/components/workspace/map/dialogs/CreateEntityDialog.tsx`
- Modify: `artifacts/studio/src/__tests__/CreateEntityDialog.test.tsx` (props type only)
- Create: `artifacts/studio/src/__tests__/CreateEntityDialog.table.test.tsx`
- Modify: `docs/CHANGELOG-implementation.md`

**Interfaces:**
- Consumes: `FormattedNumberInput` (P1); `WAREHOUSE_ROLE`, `REFINERY_ROLE`, `CUSTOMER_ROLE`, `PLANT_ROLE`, `MINE_ROLE`, `STATION_ROLE`, `AddedWarehouseInput`, `AddedCustomerInput`, `AddedPlantInput` (`map/types.ts`); `newUid`, `nextDisplayCode` (`lib/entityId.ts` — `pl` = `ap-`/`PL-…`, identical to `PlantsTab`'s local helpers); `lookupCity` (`lib/gazetteer.ts`).
- Produces: `CreateEntityKind`, `CreateEntitySubmit`, `AddedMineInput`, `AddedStationInput`, `MapCreateEntityDialogProps`, `CreateEntityDialogProps` (= map | `{ source: "table", entityKind, capacityMode?, hasStateColumn?, products?, existingCodes, onCreate, onCancel }`). Consumed by P4.10–P4.14; the map callers (`InputMapTab.tsx`, 4 sites) are unchanged.

**Table-mode rules (all pinned by the new test):** lat/lng are text inputs, filled from the gazetteer on City/State blur until the student first focuses them (which clears the auto-fill — the inline forms' rule); the display code is always generated with `nextDisplayCode` (`lib/entityId.ts:49`) from City/State, known or unknown city (user answer 2026-10-17), and stays editable; a typed code is collision-checked; validation order and messages are the inline forms' verbatim — "City and state are both required." / "City is required." (no state column) → "Display code '{c}' is already in use by another {label} in this scenario." → "Latitude and longitude must both be numbers." → "Capacity must be a positive number, or left blank." (warehouse) / "… or left blank for unconstrained." (mine) → "Demand must be a number ≥ 0." / "Demand for {product} must be a number ≥ 0." (an **empty** demand fails); fields per kind: warehouse status (+ capacity when `per_wh`), refinery status, plant none, mine capacity, customer demand (JADE: one per product), station demand (integer); demand inputs are `FormattedNumberInput` with "Units" (customers) / "tons" (stations); `capacity` is omitted when not shown; ids `aw-`/`ac-`/`ap-`/`am-`/`as-`.

- [ ] **Step 0: Invoke the simplicity skills**

Skill tool: `andrej-karpathy-skills:karpathy-guidelines`, then `ponytail:ponytail`. Record in the report that both ran (hard rule #12).

- [ ] **Step 1: Preconditions**

Run each line alone (worktree root):
```bash
cd /Users/shubhamkr/nos-scu-2.p4.2 && git rev-parse --abbrev-ref HEAD
git merge-base --is-ancestor "$BASE" HEAD || exit 1
git merge-base --is-ancestor "$B1_TIP" HEAD || exit 1
git merge-base --is-ancestor "$P3_TIP" HEAD || exit 1
test -f artifacts/studio/src/components/data-table/DataTable.tsx && test -f artifacts/studio/src/components/data-table/DownloadMenu.tsx && test -d lib/import-schema || exit 1
pnpm install --frozen-lockfile
```

- [ ] **Step 2: Write the failing test**

Create `artifacts/studio/src/__tests__/CreateEntityDialog.table.test.tsx`:

```bash
mkdir -p artifacts/studio/src/__tests__ && cat > artifacts/studio/src/__tests__/CreateEntityDialog.table.test.tsx <<'SCU_EOF'
// SCU-2.P4.2 (spec B2.8, B2.9) — CreateEntityDialog opened from an input
// table ("+ Add {Entity}"). The map flow is covered, unchanged, by
// CreateEntityDialog.test.tsx; this file covers the table mode: editable
// lat/lng, per-kind fields, the inline forms' validation messages verbatim,
// empty demand blocking submit, and the discriminated submit for six kinds.

import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import {
  CreateEntityDialog,
  type CreateEntityKind,
  type CreateEntitySubmit,
} from "@/components/workspace/map/dialogs/CreateEntityDialog";

function open(entityKind: CreateEntityKind, extra: Partial<{ capacityMode: "none" | "uniform" | "per_wh"; hasStateColumn: boolean; products: { id: string; name: string }[]; existingCodes: string[] }> = {}) {
  const onCreate = vi.fn<(r: CreateEntitySubmit) => void>();
  const onCancel = vi.fn();
  render(
    <CreateEntityDialog
      source="table"
      entityKind={entityKind}
      existingCodes={extra.existingCodes ?? []}
      capacityMode={extra.capacityMode}
      hasStateColumn={extra.hasStateColumn}
      products={extra.products}
      onCreate={onCreate}
      onCancel={onCancel}
    />,
  );
  return { onCreate, onCancel };
}

const type = (testId: string, value: string) => fireEvent.change(screen.getByTestId(testId), { target: { value } });
const submit = () => fireEvent.click(screen.getByTestId("create-entity-submit"));
const errorText = () => screen.getByTestId("create-entity-error").textContent;

function fillLocation(city = "Akron", state = "OH", lat = "41.08", lng = "-81.52") {
  type("create-entity-city", city);
  type("create-entity-state", state);
  type("create-entity-lat", lat);
  type("create-entity-lng", lng);
}

describe("CreateEntityDialog — table mode (SCU-2.P4.2)", () => {
  it("lat/lng are editable inputs, empty on open, filled from the gazetteer on City/State blur", () => {
    open("customer");
    const latInput = screen.getByTestId("create-entity-lat");
    expect(latInput.tagName).toBe("INPUT");
    expect(latInput).toHaveValue("");
    type("create-entity-city", "Akron");
    type("create-entity-state", "OH");
    fireEvent.blur(screen.getByTestId("create-entity-state"));
    expect(screen.getByTestId("create-entity-lat")).toHaveValue("41.080456");
    expect(screen.getByTestId("create-entity-lng")).toHaveValue("-81.521429");
  });

  it("a lat/lng the student focused and typed is never overwritten by a later City/State blur", () => {
    open("customer");
    fireEvent.focus(screen.getByTestId("create-entity-lat"));
    type("create-entity-lat", "1");
    type("create-entity-city", "Akron");
    type("create-entity-state", "OH");
    fireEvent.blur(screen.getByTestId("create-entity-city"));
    expect(screen.getByTestId("create-entity-lat")).toHaveValue("1");
    expect(screen.getByTestId("create-entity-lng")).toHaveValue("-81.521429");
  });

  it("the first focus clears a gazetteer-filled lat (the inline forms' 'touched' rule)", () => {
    open("customer");
    type("create-entity-city", "Akron");
    type("create-entity-state", "OH");
    fireEvent.blur(screen.getByTestId("create-entity-state"));
    expect(screen.getByTestId("create-entity-lat")).toHaveValue("41.080456");
    fireEvent.focus(screen.getByTestId("create-entity-lat"));
    expect(screen.getByTestId("create-entity-lat")).toHaveValue("");
    expect(screen.getByTestId("create-entity-lng")).toHaveValue("-81.521429");
  });

  it.each<[CreateEntityKind, { capacity: boolean; status: boolean; demand: boolean }]>([
    ["warehouse", { capacity: false, status: true, demand: false }],
    ["refinery", { capacity: false, status: true, demand: false }],
    ["plant", { capacity: false, status: false, demand: false }],
    ["mine", { capacity: true, status: false, demand: false }],
    ["station", { capacity: false, status: false, demand: true }],
    ["customer", { capacity: false, status: false, demand: true }],
  ])("%s shows exactly its own fields", (kind, f) => {
    open(kind);
    expect(screen.queryByTestId("create-entity-capacity") !== null).toBe(f.capacity);
    expect(screen.queryByTestId("create-entity-status") !== null).toBe(f.status);
    expect(screen.queryByTestId("create-entity-demand") !== null).toBe(f.demand);
  });

  it("warehouse capacity appears only for capacityMode per_wh", () => {
    open("warehouse", { capacityMode: "per_wh" });
    expect(screen.getByTestId("create-entity-capacity")).toBeInTheDocument();
  });

  it("uses the inline forms' validation messages, in the inline forms' order", () => {
    open("warehouse", { capacityMode: "per_wh", existingCodes: ["WH-OH-AKRON-01"] });
    submit();
    expect(errorText()).toBe("City and state are both required.");
    type("create-entity-city", "Akron");
    type("create-entity-state", "OH");
    type("create-entity-display-code", "WH-OH-AKRON-01");
    submit();
    expect(errorText()).toBe("Display code 'WH-OH-AKRON-01' is already in use by another warehouse in this scenario.");
    type("create-entity-display-code", "WH-OH-AKRON-07");
    submit();
    expect(errorText()).toBe("Latitude and longitude must both be numbers.");
    type("create-entity-lat", "41.08");
    type("create-entity-lng", "-81.52");
    type("create-entity-capacity", "0");
    submit();
    expect(errorText()).toBe("Capacity must be a positive number, or left blank.");
  });

  it("no State field and 'City is required.' when the dataset has no state column", () => {
    open("customer", { hasStateColumn: false });
    expect(screen.queryByTestId("create-entity-state")).toBeNull();
    submit();
    expect(errorText()).toBe("City is required.");
  });

  it("mine capacity uses the mines form's message", () => {
    open("mine");
    fillLocation("Pikeville", "KY", "37.54", "-82.75");
    type("create-entity-capacity", "-3");
    submit();
    expect(errorText()).toBe("Capacity must be a positive number, or left blank for unconstrained.");
  });

  it("an EMPTY scalar demand blocks submit (B2.9), and demand is grouped with a linked Units suffix", () => {
    const { onCreate } = open("customer");
    fillLocation();
    submit();
    expect(errorText()).toBe("Demand must be a number ≥ 0.");
    expect(onCreate).not.toHaveBeenCalled();
    const demand = screen.getByTestId("create-entity-demand");
    type("create-entity-demand", "12345.5");
    expect(demand).toHaveValue("12,345.5");
    expect(demand).not.toHaveAttribute("aria-label");
    const suffix = document.getElementById(demand.getAttribute("aria-describedby")!);
    expect(suffix).toHaveTextContent("Units");
  });

  it("JADE: an empty per-product demand blocks submit with that product's message (no silent 0)", () => {
    const products = [{ id: "product-1", name: "Hats" }, { id: "product-2", name: "Shoes" }];
    const { onCreate } = open("customer", { products });
    expect(screen.queryByTestId("create-entity-demand")).toBeNull();
    fillLocation();
    type("create-entity-demand-product-1", "10");
    submit();
    expect(errorText()).toBe("Demand for Shoes must be a number ≥ 0.");
    expect(onCreate).not.toHaveBeenCalled();
    type("create-entity-demand-product-2", "0");
    submit();
    expect(onCreate).toHaveBeenCalledTimes(1);
    const r = onCreate.mock.calls[0]![0];
    expect(r.kind).toBe("customer");
    expect(r.entity).toMatchObject({ demand: 10, demands: { "product-1": 10, "product-2": 0 } });
  });

  it("station demand is integer-only ('.' rejected)", () => {
    open("station");
    type("create-entity-demand", "12.5");
    expect(screen.getByTestId("create-entity-demand")).toHaveValue("");
    type("create-entity-demand", "8000000");
    expect(screen.getByTestId("create-entity-demand")).toHaveValue("8,000,000");
    // station demand is in tons (user decision 2026-10-17); customers keep "Units"
    const input = screen.getByTestId("create-entity-demand");
    expect(document.getElementById(input.getAttribute("aria-describedby") ?? "")).toHaveTextContent("tons");
  });

  it.each<[CreateEntityKind, RegExp, Record<string, unknown>]>([
    ["warehouse", /^aw-/, { status: "forced_open" }],
    ["refinery", /^aw-/, { status: "forced_open" }],
    ["plant", /^ap-/, {}],
    ["mine", /^am-/, { capacity: 25000000 }],
    ["station", /^as-/, { demand: 8000000 }],
    ["customer", /^ac-/, { demand: 205375 }],
  ])("submits a discriminated %s result with a minted id and the derived display code", (kind, idPattern, extra) => {
    const { onCreate } = open(kind);
    fillLocation();
    if (kind === "warehouse" || kind === "refinery") fireEvent.click(screen.getByTestId("create-entity-status-forced_open"));
    if (kind === "mine") type("create-entity-capacity", "25000000");
    if (kind === "station") type("create-entity-demand", "8000000");
    if (kind === "customer") type("create-entity-demand", "205375");
    submit();
    expect(onCreate).toHaveBeenCalledTimes(1);
    const r = onCreate.mock.calls[0]![0];
    expect(r.kind).toBe(kind);
    expect(r.entity.id).toMatch(idPattern);
    expect(r.entity).toMatchObject({ city: "Akron", state: "OH", lat: 41.08, lng: -81.52, ...extra });
    expect(r.entity.displayCode).toMatch(/^(WH|PL|MN|ST|CS)-OH-AKRON-01$/);
    if (kind === "plant") expect(Object.keys(r.entity).sort()).toEqual(["city", "displayCode", "id", "lat", "lng", "state"]);
    if (kind === "refinery") expect(r.entity).not.toHaveProperty("capacity");
  });

  it("Cancel calls onCancel and never onCreate", () => {
    const { onCreate, onCancel } = open("plant");
    fireEvent.click(screen.getByTestId("create-entity-cancel"));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onCreate).not.toHaveBeenCalled();
  });
});
SCU_EOF
```

- [ ] **Step 3: Run it to verify it fails**

Run: `pnpm --filter studio exec vitest run src/__tests__/CreateEntityDialog.table.test.tsx`
Expected: FAIL — `Tests  21 failed | 2 passed (23)` (measured at plan time) — `CreateEntityKind` / `CreateEntitySubmit` are not exported and `source="table"` renders the map form (no editable `create-entity-lat` input, no `create-entity-error`).

- [ ] **Step 4: Implement**

The edit renames today's component body to the private `MapCreateEntityDialog` (body unchanged), adds the table-mode component and the exported dispatcher, and updates the map test's props type:

```bash
python3 - <<'PY'
import pathlib
EDITS = [
    ('artifacts/studio/src/__tests__/CreateEntityDialog.test.tsx',
     '''import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { CreateEntityDialog } from "@/components/workspace/map/dialogs/CreateEntityDialog";
import { MINE_ROLE, REFINERY_ROLE, STATION_ROLE, PLANT_ROLE } from "@/components/workspace/map/types";
''',
     '''import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { CreateEntityDialog, type MapCreateEntityDialogProps } from "@/components/workspace/map/dialogs/CreateEntityDialog";
import { MINE_ROLE, REFINERY_ROLE, STATION_ROLE, PLANT_ROLE } from "@/components/workspace/map/types";
'''),
    ('artifacts/studio/src/__tests__/CreateEntityDialog.test.tsx',
     '''const RENO_LNG = -119.81;

function renderDialog(props: Partial<React.ComponentProps<typeof CreateEntityDialog>> = {}) {
  const onSubmit = vi.fn();
  const onCancel = vi.fn();''',
     '''const RENO_LNG = -119.81;

function renderDialog(props: Partial<MapCreateEntityDialogProps> = {}) {
  const onSubmit = vi.fn();
  const onCancel = vi.fn();'''),
    ('artifacts/studio/src/components/workspace/map/dialogs/CreateEntityDialog.tsx',
     '''  CUSTOMER_ROLE,
  PLANT_ROLE,
  type AddedCustomerInput,
  type AddedWarehouseInput,
  type EntityRoleConfig,
} from "@/components/workspace/map/types";
import { nearestCity } from "@/lib/gazetteer";
import { newUid, nextDisplayCode } from "@/lib/entityId";
''',
     '''  CUSTOMER_ROLE,
  PLANT_ROLE,
  MINE_ROLE,
  STATION_ROLE,
  REFINERY_ROLE,
  type AddedCustomerInput,
  type AddedPlantInput,
  type AddedWarehouseInput,
  type EntityRoleConfig,
} from "@/components/workspace/map/types";
import { lookupCity, nearestCity } from "@/lib/gazetteer";
import { FormattedNumberInput } from "@/components/data-table/FormattedNumberInput";
import { newUid, nextDisplayCode } from "@/lib/entityId";
'''),
    ('artifacts/studio/src/components/workspace/map/dialogs/CreateEntityDialog.tsx',
     '''}

interface CreateEntityDialogProps {
  /** Rendering role — "wh" is a triangle marker (warehouse/mine/refinery),
   * "cs" is a demand bubble (customer/station), "pl" is a square marker''',
     '''}

export interface MapCreateEntityDialogProps {
  /** SCU-2.P4.2 — omitted (or "map") = today's map flow, unchanged. */
  source?: "map";
  /** Rendering role — "wh" is a triangle marker (warehouse/mine/refinery),
   * "cs" is a demand bubble (customer/station), "pl" is a square marker'''),
    ('artifacts/studio/src/components/workspace/map/dialogs/CreateEntityDialog.tsx',
     '''// the dialog's whole lifetime — regenerating it per keystroke would change
// the join key mid-edit, which the T3 uid contract forbids.
export function CreateEntityDialog({
  kind,
  role = kind === "wh" ? WAREHOUSE_ROLE : kind === "pl" ? PLANT_ROLE : CUSTOMER_ROLE,''',
     '''// the dialog's whole lifetime — regenerating it per keystroke would change
// the join key mid-edit, which the T3 uid contract forbids.
function MapCreateEntityDialog({
  kind,
  role = kind === "wh" ? WAREHOUSE_ROLE : kind === "pl" ? PLANT_ROLE : CUSTOMER_ROLE,'''),
    ('artifacts/studio/src/components/workspace/map/dialogs/CreateEntityDialog.tsx',
     '''  onSubmit,
  onCancel,
}: CreateEntityDialogProps) {
  const nearest = useMemo(() => nearestCity(lat, lng), [lat, lng]);
  const [city, setCity] = useState(nearest.city);''',
     '''  onSubmit,
  onCancel,
}: MapCreateEntityDialogProps) {
  const nearest = useMemo(() => nearestCity(lat, lng), [lat, lng]);
  const [city, setCity] = useState(nearest.city);'''),
    ('artifacts/studio/src/components/workspace/map/dialogs/CreateEntityDialog.tsx',
     '''    </Dialog>
  );
}
''',
     '''    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// SCU-2.P4.2 (spec B2.8) — "+ Add {Entity}" from an input table. Same dialog
// shell and `create-entity-*` testids as the map flow, but:
//   - lat/lng are editable inputs (the map prefills them read-only), filled
//     from the gazetteer on City/State blur while they are still empty;
//   - the display code is editable (derived until the student types one);
//   - validation messages are the inline add forms' messages, verbatim;
//   - demand (customer, station, JADE per product) is a FormattedNumberInput
//     and an EMPTY demand blocks submit (B2.9 — no silent 0);
//   - submit emits a discriminated `CreateEntitySubmit` for six kinds.
// ---------------------------------------------------------------------------

export type CreateEntityKind = "warehouse" | "customer" | "plant" | "mine" | "station" | "refinery";

export interface AddedMineInput {
  id: string;
  displayCode?: string;
  city: string;
  state: string;
  lat: number;
  lng: number;
  capacity?: number | null;
}

export interface AddedStationInput {
  id: string;
  displayCode?: string;
  city: string;
  state: string;
  lat: number;
  lng: number;
  demand: number;
}

export type CreateEntitySubmit =
  | { kind: "warehouse"; entity: AddedWarehouseInput }
  | { kind: "refinery"; entity: AddedWarehouseInput }
  | { kind: "customer"; entity: AddedCustomerInput & { demands?: Record<string, number> } }
  | { kind: "plant"; entity: AddedPlantInput }
  | { kind: "mine"; entity: AddedMineInput }
  | { kind: "station"; entity: AddedStationInput };

interface TableCreateEntityDialogProps {
  source: "table";
  entityKind: CreateEntityKind;
  /** Warehouses: "per_wh" shows Capacity (as the inline form did). Ignored for other kinds. */
  capacityMode?: "none" | "uniform" | "per_wh";
  /** false → no State field and "City is required." (WarehousesTab/CustomersTab `hasStateColumn`). */
  hasStateColumn?: boolean;
  /** JADE: one required demand field per product instead of the scalar demand. */
  products?: ReadonlyArray<{ id: string; name: string }>;
  /** Display codes already used by this entity's ADDED rows (collision check + derivation). */
  existingCodes: Iterable<string>;
  onCreate: (result: CreateEntitySubmit) => void;
  onCancel: () => void;
}

export type CreateEntityDialogProps = MapCreateEntityDialogProps | TableCreateEntityDialogProps;

export function CreateEntityDialog(props: CreateEntityDialogProps) {
  return props.source === "table" ? <TableCreateEntityDialog {...props} /> : <MapCreateEntityDialog {...props} />;
}

const TABLE_ROLE: Record<CreateEntityKind, EntityRoleConfig> = {
  warehouse: WAREHOUSE_ROLE,
  refinery: REFINERY_ROLE,
  customer: CUSTOMER_ROLE,
  plant: PLANT_ROLE,
  mine: MINE_ROLE,
  station: STATION_ROLE,
};

const CAPACITY_ERROR: Partial<Record<CreateEntityKind, string>> = {
  warehouse: "Capacity must be a positive number, or left blank.",
  mine: "Capacity must be a positive number, or left blank for unconstrained.",
};

function TableCreateEntityDialog({
  entityKind,
  capacityMode,
  hasStateColumn = true,
  products = [],
  existingCodes,
  onCreate,
  onCancel,
}: TableCreateEntityDialogProps) {
  const role = TABLE_ROLE[entityKind];
  const id = useMemo(() => newUid(role.uidKind), [role.uidKind]);
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [lat, setLat] = useState("");
  const [lng, setLng] = useState("");
  // The inline forms' "touched" rule (WarehousesTab T9): the first focus of
  // lat/lng clears it and stops later City/State blurs from auto-filling it.
  const [latTouched, setLatTouched] = useState(false);
  const [lngTouched, setLngTouched] = useState(false);
  const [typedCode, setTypedCode] = useState<string | null>(null);
  const [status, setStatus] = useState<WhStatus>("active");
  const [capacity, setCapacity] = useState("");
  const [demand, setDemand] = useState<number | null>(null);
  const [demands, setDemands] = useState<Record<string, number | null>>({});
  const [error, setError] = useState<string | null>(null);

  const codes = useMemo(() => Array.from(existingCodes), [existingCodes]);
  const derivedCode = nextDisplayCode(role.uidKind, state.trim(), city.trim(), codes);
  const displayCode = typedCode ?? derivedCode;

  const showCapacity =
    entityKind === "mine" || (entityKind === "warehouse" && capacityMode === "per_wh");
  const showStatus = entityKind === "warehouse" || entityKind === "refinery";
  const isDemandKind = entityKind === "customer" || entityKind === "station";
  const perProduct = entityKind === "customer" && products.length > 0;

  function handleCityStateBlur() {
    const c = city.trim();
    const st = state.trim();
    if (!c || !st) return;
    const hit = lookupCity(c, st);
    if (!hit) return;
    if (!latTouched) setLat(String(hit.lat));
    if (!lngTouched) setLng(String(hit.lng));
  }

  function handleSubmit() {
    const c = city.trim();
    const st = state.trim();
    if (!c || (hasStateColumn && !st)) {
      setError(hasStateColumn ? "City and state are both required." : "City is required.");
      return;
    }
    const code = displayCode.trim();
    if (typedCode !== null && code && codes.includes(code)) {
      setError(`Display code '${code}' is already in use by another ${role.label} in this scenario.`);
      return;
    }
    const latN = parseFloat(lat);
    const lngN = parseFloat(lng);
    if (!Number.isFinite(latN) || !Number.isFinite(lngN)) {
      setError("Latitude and longitude must both be numbers.");
      return;
    }
    let cap: number | null = null;
    if (showCapacity && capacity.trim() !== "") {
      const parsed = parseFloat(capacity);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        setError(CAPACITY_ERROR[entityKind]!);
        return;
      }
      cap = parsed;
    }
    const base = { id, displayCode: code || undefined, city: c, state: st, lat: latN, lng: lngN };

    if (perProduct) {
      const out: Record<string, number> = {};
      for (const p of products) {
        const v = demands[p.id];
        if (v == null) {
          setError(`Demand for ${p.name} must be a number ≥ 0.`);
          return;
        }
        out[p.id] = v;
      }
      const total = Object.values(out).reduce((sum, v) => sum + v, 0);
      onCreate({ kind: "customer", entity: { ...base, demand: total, demands: out } });
      return;
    }
    if (isDemandKind && demand == null) {
      setError("Demand must be a number ≥ 0.");
      return;
    }
    switch (entityKind) {
      case "customer":
        onCreate({ kind: "customer", entity: { ...base, demand: demand! } });
        return;
      case "station":
        onCreate({ kind: "station", entity: { ...base, demand: demand! } });
        return;
      case "mine":
        onCreate({ kind: "mine", entity: { ...base, capacity: cap } });
        return;
      case "plant":
        onCreate({ kind: "plant", entity: base });
        return;
      case "warehouse":
        onCreate({ kind: "warehouse", entity: { ...base, ...(showCapacity ? { capacity: cap } : {}), status } });
        return;
      case "refinery":
        onCreate({ kind: "refinery", entity: { ...base, status } });
        return;
    }
  }

  const field = (testId: string, label: string, input: React.ReactNode) => (
    <div className="space-y-1">
      <Label htmlFor={testId} className="text-xs font-semibold text-foreground">
        {label}
      </Label>
      {input}
    </div>
  );

  return (
    <Dialog open onOpenChange={open => !open && onCancel()}>
      <DialogContent data-testid="create-entity-dialog">
        <DialogHeader>
          <DialogTitle className="font-heading">{`New ${role.label}`}</DialogTitle>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <div className="grid grid-cols-2 gap-3">
            {field(
              "create-entity-city",
              "City",
              <Input id="create-entity-city" value={city} onChange={e => setCity(e.target.value)} onBlur={handleCityStateBlur} data-testid="create-entity-city" />,
            )}
            {hasStateColumn &&
              field(
                "create-entity-state",
                "State",
                <Input id="create-entity-state" value={state} onChange={e => setState(e.target.value)} onBlur={handleCityStateBlur} data-testid="create-entity-state" />,
              )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            {field(
              "create-entity-lat",
              "Latitude",
              <Input
                id="create-entity-lat"
                inputMode="decimal"
                value={lat}
                onFocus={() => {
                  if (!latTouched) {
                    setLatTouched(true);
                    setLat("");
                  }
                }}
                onChange={e => setLat(e.target.value)}
                className={`font-mono ${!latTouched && lat ? "bg-muted text-muted-foreground" : ""}`}
                data-testid="create-entity-lat"
              />,
            )}
            {field(
              "create-entity-lng",
              "Longitude",
              <Input
                id="create-entity-lng"
                inputMode="decimal"
                value={lng}
                onFocus={() => {
                  if (!lngTouched) {
                    setLngTouched(true);
                    setLng("");
                  }
                }}
                onChange={e => setLng(e.target.value)}
                className={`font-mono ${!lngTouched && lng ? "bg-muted text-muted-foreground" : ""}`}
                data-testid="create-entity-lng"
              />,
            )}
          </div>
          {field(
            "create-entity-display-code",
            "Display code",
            <Input
              id="create-entity-display-code"
              value={displayCode}
              onChange={e => setTypedCode(e.target.value)}
              data-testid="create-entity-display-code"
            />,
          )}

          {showStatus && (
            <div className="space-y-2">
              <Label className="text-xs font-semibold text-foreground">Status</Label>
              <RadioGroup value={status} onValueChange={v => setStatus(v as WhStatus)} data-testid="create-entity-status">
                {STATUS_OPTIONS.map(option => (
                  <div key={option} className="flex items-center gap-2">
                    <RadioGroupItem value={option} id={`create-entity-status-${option}`} data-testid={`create-entity-status-${option}`} />
                    <Label htmlFor={`create-entity-status-${option}`} className="text-sm font-normal">
                      {warehouseStatusPresentation[option].label}
                    </Label>
                  </div>
                ))}
              </RadioGroup>
            </div>
          )}
          {showCapacity &&
            field(
              "create-entity-capacity",
              "Capacity",
              <Input
                id="create-entity-capacity"
                type="number"
                min={0}
                value={capacity}
                onChange={e => setCapacity(e.target.value)}
                className="font-mono"
                data-testid="create-entity-capacity"
              />,
            )}
          {perProduct
            ? products.map(p =>
                field(
                  `create-entity-demand-${p.id}`,
                  `Demand — ${p.name}`,
                  <FormattedNumberInput
                    id={`create-entity-demand-${p.id}`}
                    value={demands[p.id] ?? null}
                    onChange={v => setDemands(prev => ({ ...prev, [p.id]: v }))}
                    suffix="Units"
                    className="font-mono"
                    data-testid={`create-entity-demand-${p.id}`}
                  />,
                ),
              )
            : isDemandKind &&
              field(
                "create-entity-demand",
                "Demand",
                <FormattedNumberInput
                  id="create-entity-demand"
                  value={demand}
                  onChange={setDemand}
                  suffix={entityKind === "station" ? "tons" : "Units"}
                  integer={entityKind === "station"}
                  className="font-mono"
                  data-testid="create-entity-demand"
                />,
              )}
          {error && (
            <p className="text-[11px] text-destructive" data-testid="create-entity-error">
              {error}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onCancel} data-testid="create-entity-cancel">
            Cancel
          </Button>
          <Button type="button" onClick={handleSubmit} data-testid="create-entity-submit">
            Add {role.label}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
'''),
]
for path, old, new in EDITS:
    f = pathlib.Path(path)
    s = f.read_text()
    n = s.count(old)
    if n != 1:
        raise SystemExit(f'STOP: {path}: anchor found {n} times (expected 1): {old[:80]!r}')
    f.write_text(s.replace(old, new, 1))
print(f'applied {len(EDITS)} edits')
PY
```

- [ ] **Step 5: Run the dialog tests**

Run: `pnpm --filter studio exec vitest run src/__tests__/CreateEntityDialog.table.test.tsx src/__tests__/CreateEntityDialog.test.tsx src/__tests__/historyReadOnlyTabs.test.ts`
Expected: PASS — 63 tests in 3 files (measured at plan time; `CreateEntityDialog.test.tsx`'s 27 map-flow tests unchanged). Also run the map consumers, unchanged: `pnpm --filter studio exec vitest run src/__tests__/InputMapTabV2.test.tsx src/__tests__/InputMapV2.integration.test.tsx src/__tests__/InputMapTabV2.jade.test.tsx src/__tests__/InputMapTabV2.transport.test.tsx src/__tests__/InputMapTabV2.twoEchelon.test.tsx src/__tests__/InputMapTabV2.customerStatus.test.tsx` → PASS. Then `pnpm --filter studio typecheck` → exit 0.

- [ ] **Step 6: Prove the new test can fail**

In the table component, change `if (isDemandKind && demand == null)` to `if (isDemandKind && demand == null && false)` → the "EMPTY scalar demand blocks submit" case fails (onCreate called with `demand: null`). Revert; re-run → PASS.

- [ ] **Step 7: e2e sweep**

Map flows use the same `create-entity-*` ids and are byte-unchanged; no table mounts the modal yet. Run the map e2e that create entities, unchanged:
```bash
cd artifacts/studio && E2E_BASE_URL=http://localhost:5179 npx playwright test e2e/input-map-v2.spec.ts e2e/workspace-fixups.spec.ts
```
Expected: pass.

- [ ] **Step 8: Gate**

Run each separately (Global Constraints):
1. `cnt=$(ps aux | grep "[v]itest" | grep -v "zsh -c" | wc -l | tr -d ' '); [ "$cnt" = "0" ]`
2. `pnpm run typecheck`
3. `pnpm --filter studio typecheck:e2e`
4. `DATABASE_URL="postgresql://shubhamkr@localhost:5432/nos_dev" pnpm --filter api-server test`
5. `pnpm --filter studio test`
6. `(cd artifacts/api-server/src/solver && python3 -m pytest tests/ -x)`
7. `pnpm --filter @workspace/import-schema test`

Expected: every command exits 0. Then `git diff --stat "$P3_TIP"..HEAD -- artifacts/api-server lib/db lib/api-spec` prints nothing.

- [ ] **Step 9: Changelog**

Append to the bottom of `docs/CHANGELOG-implementation.md`:

```markdown

### SCU-2.P4.2 — CreateEntityDialog table mode

- `CreateEntityDialog` gains `source: "table"` (six kinds, discriminated `CreateEntitySubmit`, editable lat/lng with the inline forms' touched rule, editable derived display code, inline validation messages verbatim, `FormattedNumberInput` demand with Units, empty demand blocks — incl. JADE per-product). Map flow unchanged (its test now types props as `MapCreateEntityDialogProps`). No table consumers yet.
- Deviations 2, 9.
- Gate: studio <N passed>, api-server <N passed>, pytest <N passed>, import-schema <N passed>. e2e (local, `E2E_BASE_URL` set): <spec: pass/fail per spec>.
```

Replace each `<…>` with the value measured in this run, or the literal `unknown`.

- [ ] **Step 10: Commit**

```bash
git add artifacts/studio/src/__tests__/CreateEntityDialog.table.test.tsx
```

```bash
[ "$(git rev-parse --abbrev-ref HEAD)" != "main" ] || exit 1
```

```bash
git commit artifacts/studio/src/__tests__/CreateEntityDialog.table.test.tsx artifacts/studio/src/__tests__/CreateEntityDialog.test.tsx artifacts/studio/src/components/workspace/map/dialogs/CreateEntityDialog.tsx docs/CHANGELOG-implementation.md -m "[SCU-2.P4.2] add table mode to CreateEntityDialog for the +Add modal" -m "source=table: six kinds, discriminated submit, editable lat/lng, inline validation messages, empty demand blocks submit (B2.8, B2.9). Map flow byte-unchanged. Deviations 2, 9." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task SCU-2.P4.3: Distances on DataTable (p-median-us, p-median-brazil, max-coverage-us) + real-browser focus check

**Owner role:** frontend-engineer. **Matrix:** §1 #10, §2b Distances. **Spec:** B2.1–B2.4, D2; P1 hand-off (focus-jump browser check). **Deviations:** 3, 4, 5, 6, 7, 15, 16, 17.

**Files:**
- Create: `artifacts/studio/src/__tests__/DistancesTab.dataTable.test.tsx`
- Modify: `artifacts/studio/src/components/workspace/tabs/DistancesTab.tsx`
- Modify: `artifacts/studio/src/__tests__/DistancesTab.test.tsx`
- Modify: `artifacts/studio/src/pages/Workspace.tsx`
- Modify: `artifacts/studio/src/__tests__/historyReadOnlyTabs.test.ts`
- Modify: `artifacts/studio/e2e/bundle5-homepage-distances.spec.ts`
- Modify: `artifacts/studio/e2e/bundle6.1-legend-distances.spec.ts`
- Modify: `artifacts/studio/e2e/chen-bands-units-qa.spec.ts`
- Modify: `artifacts/studio/e2e/max-coverage.spec.ts`
- Modify: `artifacts/studio/e2e/input-map-v2.spec.ts`
- Delete: `artifacts/studio/src/__tests__/DataTable.distancesReplica.test.tsx`
- Modify: `docs/CHANGELOG-implementation.md` (append `### SCU-2.P4.3`)

**Interfaces:**
- Consumes: `DataTable`, `ColumnDef`, `DataTableFocus` (P1); `useEntityFileMenus` (P4.1); `useDistanceDraft`, `useGetReferenceDistances`, `EntityIdCell` (unchanged).
- Produces: `DistancesTab` prop `readOnly?: boolean`; the matrix testid map unchanged except the menu/pager rows of the global testid table.

**Behaviour changes (record each in the changelog):**
- From/To boxes → FilterMenu (`from`/`to` text on the display code, plus Base/Override ranges) above 10 rows.
- Pager only above 50 rows (was always on); deleting a row resets to page 1.
- Upload ▾ / Download ▾ with the expected-fields panel.
- History read-only on override inputs, remove buttons and "+ Add row" (D2).
- Numbers centred; reference banners above the toolbar.

- [ ] **Step 0: Invoke the simplicity skills**

Skill tool: `andrej-karpathy-skills:karpathy-guidelines`, then `ponytail:ponytail`. Record in the report that both ran (hard rule #12).

- [ ] **Step 1: Preconditions**

Run each line alone (worktree root):
```bash
cd /Users/shubhamkr/nos-scu-2.p4.3 && git rev-parse --abbrev-ref HEAD
git merge-base --is-ancestor "$BASE" HEAD || exit 1
git merge-base --is-ancestor "$B1_TIP" HEAD || exit 1
git merge-base --is-ancestor "$P3_TIP" HEAD || exit 1
test -f artifacts/studio/src/components/data-table/DataTable.tsx && test -f artifacts/studio/src/components/data-table/DownloadMenu.tsx && test -d lib/import-schema || exit 1
pnpm install --frozen-lockfile
```
Then confirm the files this task replaces wholesale are still the `46d2f98` text (Global Constraints):
```bash
git diff --quiet 46d2f98 HEAD -- artifacts/studio/src/components/workspace/tabs/DistancesTab.tsx || { echo 'STOP: artifacts/studio/src/components/workspace/tabs/DistancesTab.tsx changed since 46d2f98'; exit 1; }
```

- [ ] **Step 2: Write the failing test**

Create `artifacts/studio/src/__tests__/DistancesTab.dataTable.test.tsx`:

```bash
mkdir -p artifacts/studio/src/__tests__ && cat > artifacts/studio/src/__tests__/DistancesTab.dataTable.test.tsx <<'SCU_EOF'
// SCU-2.P4.3 — DistancesTab on the shared DataTable (spec B2.1–B2.4, D2).
// Pins: every testid in the matrix map is still emitted (plus the new menu
// triggers), history read-only reaches every control, the amber changed
// row, numbers centred, the pager only above 50 rows, and one edit
// round-trip through a stateful parent.

import { useState } from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { AllProviders } from "@/__tests__/helpers/renderWithExportProvider";
import { DistancesTab, type DistanceOverride } from "@/components/workspace/tabs/DistancesTab";

function Providers({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={client}>
      <AllProviders>{children}</AllProviders>
    </QueryClientProvider>
  );
}

// 3 warehouses × 20 customers = 60 rows → two pages. WH03 and C020 are
// unknown ids (warning icons); WH02→C005 is estimated; the last two rows
// differ from the saved state (Changed, amber).
const current: DistanceOverride[] = [];
for (const w of ["WH01", "WH02", "WH03"]) {
  for (let c = 1; c <= 20; c++) {
    current.push({ fromId: w, toId: `C${String(c).padStart(3, "0")}`, distance: 100 + c, estimated: w === "WH02" && c === 5 });
  }
}
const saved = current.slice(0, 59).map((o, i) => (i === 58 ? { ...o, distance: 1 } : o));
const warehouseIds = ["WH01", "WH02"];
const customerIds = Array.from({ length: 19 }, (_, i) => `C${String(i + 1).padStart(3, "0")}`);

function renderTab(props: Partial<React.ComponentProps<typeof DistancesTab>> = {}) {
  return render(
    <DistancesTab
      distanceOverrides={current}
      savedDistanceOverrides={saved}
      warehouseIds={warehouseIds}
      customerIds={customerIds}
      onChange={vi.fn()}
      canonicalUnit="mi"
      scenarioId={1}
      {...props}
    />,
    { wrapper: Providers },
  );
}

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

describe("DistancesTab on DataTable (SCU-2.P4.3)", () => {
  it("emits every testid in the matrix map (page 1, page 2, add form)", () => {
    renderTab();
    for (const id of [
      "distances-tab",
      "distances-tab-toolbar",
      "button-import-distances",
      "button-download-distances",
      "button-filter-menu-trigger",
      "row-distance-WH01-C001",
      "input-distance-WH01-C001",
      "button-remove-distance-WH01-C001",
      "warning-unknown-to-WH01-C020",
      "badge-distance-estimated-WH02-C005",
      "button-distances-prev",
      "button-distances-next",
      "distances-page-indicator",
      "button-add-distance-row",
    ]) {
      expect(screen.getByTestId(id)).toBeInTheDocument();
    }
    expect(screen.getByTestId("distances-page-indicator")).toHaveTextContent("Page 1 of 2");
    fireEvent.click(screen.getByTestId("button-distances-next"));
    expect(screen.getByTestId("warning-unknown-from-WH03-C020")).toBeInTheDocument();
    expect(screen.getByTestId("badge-distance-changed-WH03-C020")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("button-download-distances"));
    expect(screen.getByTestId("button-export-distances-csv")).toBeInTheDocument();
    expect(screen.getByTestId("button-export-distances-json")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("button-add-distance-row"));
    for (const id of [
      "add-distance-row-form",
      "input-new-distance-from",
      "input-new-distance-to",
      "input-new-distance-value",
      "button-add-distance-confirm",
      "button-add-distance-cancel",
    ]) {
      expect(screen.getByTestId(id)).toBeInTheDocument();
    }
    fireEvent.click(screen.getByTestId("button-add-distance-confirm"));
    expect(screen.getByTestId("text-add-distance-error")).toHaveTextContent("From ID and To ID are both required.");
  });

  it("the From/To boxes are gone; the filter menu's from/to text controls replace them", () => {
    renderTab();
    expect(within(screen.getByTestId("distances-tab-toolbar")).queryByRole("textbox")).toBeNull();
    fireEvent.click(screen.getByTestId("button-filter-menu-trigger"));
    expect(screen.getByTestId("input-filter-from")).toBeInTheDocument();
    expect(screen.getByTestId("input-filter-to")).toBeInTheDocument();
    expect(screen.getByTestId("input-filter-base-min")).toBeInTheDocument();
    expect(screen.getByTestId("input-filter-override-min")).toBeInTheDocument();
  });

  it("the pager is hidden at ≤ 50 rows and the empty state keeps its testid", () => {
    const { unmount } = renderTab({ distanceOverrides: current.slice(0, 50), savedDistanceOverrides: current.slice(0, 50) });
    expect(screen.queryByTestId("distances-page-indicator")).toBeNull();
    unmount();
    renderTab({ distanceOverrides: [], savedDistanceOverrides: [] });
    expect(screen.getByTestId("distances-tab-empty")).toHaveTextContent("No distance overrides yet");
    expect(screen.getByTestId("button-add-distance-row")).toBeInTheDocument();
  });

  it("numbers are centre-aligned (Base / Override header and cells)", () => {
    renderTab();
    const headers = within(screen.getByTestId("distances-tab")).getAllByRole("columnheader");
    expect(headers.map(h => h.textContent)).toEqual(["From", "To", "Base (mi)", "Override (mi)", ""]);
    expect(headers[2]).toHaveClass("text-center");
    expect(headers[3]).toHaveClass("text-center");
    expect(headers[0]).not.toHaveClass("text-center");
    const cells = within(screen.getByTestId("row-distance-WH01-C001")).getAllByRole("cell");
    expect(cells[3]).toHaveClass("text-center");
  });

  it("amber: a row that differs from the saved state is highlighted; an unchanged one is not", () => {
    renderTab();
    fireEvent.click(screen.getByTestId("button-distances-next"));
    expect(screen.getByTestId("row-distance-WH03-C020")).toHaveClass("bg-amber-50");
    expect(screen.getByTestId("row-distance-WH03-C011")).not.toHaveClass("bg-amber-50");
  });

  it("history read-only (D2): override inputs, remove buttons and the add trigger are disabled", () => {
    renderTab({ readOnly: true });
    expect(screen.getByTestId("input-distance-WH01-C001")).toBeDisabled();
    expect(screen.getByTestId("input-distance-WH01-C001")).toHaveAttribute("title", "Read-only while browsing result history.");
    expect(screen.getByTestId("button-remove-distance-WH01-C001")).toBeDisabled();
    expect(screen.getByTestId("button-add-distance-row")).toBeDisabled();
  });

  it("not read-only by default (live editing unchanged)", () => {
    renderTab();
    expect(screen.getByTestId("input-distance-WH01-C001")).toBeEnabled();
    expect(screen.getByTestId("button-remove-distance-WH01-C001")).toBeEnabled();
  });

  it("edit round-trip: committing an override reaches the parent and re-renders as Changed", () => {
    function Parent() {
      const [rows, setRows] = useState(current.slice(0, 3));
      return (
        <DistancesTab
          distanceOverrides={rows}
          savedDistanceOverrides={current.slice(0, 3)}
          warehouseIds={warehouseIds}
          customerIds={customerIds}
          onChange={setRows}
          canonicalUnit="mi"
        />
      );
    }
    render(<Parent />, { wrapper: Providers });
    const input = screen.getByTestId("input-distance-WH01-C002");
    fireEvent.change(input, { target: { value: "777" } });
    fireEvent.blur(input);
    expect(screen.getByTestId("input-distance-WH01-C002")).toHaveValue("777");
    expect(screen.getByTestId("badge-distance-changed-WH01-C002")).toBeInTheDocument();
    expect(screen.getByTestId("row-distance-WH01-C002")).toHaveClass("bg-amber-50");
  });

  it("focus jump: clears an active filter and moves to the target's page (jsdom proves the page; Playwright proves the scroll)", () => {
    const { rerender } = renderTab();
    fireEvent.click(screen.getByTestId("button-filter-menu-trigger"));
    fireEvent.change(screen.getByTestId("input-filter-from"), { target: { value: "WH01" } });
    expect(screen.queryByTestId("row-distance-WH03-C010")).toBeNull();
    rerender(
      <DistancesTab
        distanceOverrides={current}
        savedDistanceOverrides={saved}
        warehouseIds={warehouseIds}
        customerIds={customerIds}
        onChange={vi.fn()}
        canonicalUnit="mi"
        scenarioId={1}
        focusEntityId="WH03"
      />,
    );
    expect(screen.getByTestId("input-filter-from")).toHaveValue("");
    expect(screen.getByTestId("distances-page-indicator")).toHaveTextContent("Page 1 of 2");
    expect(screen.getByTestId("row-distance-WH03-C001")).toBeInTheDocument();
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
  });
});
SCU_EOF
```

- [ ] **Step 3: Run it to verify it fails**

Run: `pnpm --filter studio exec vitest run src/__tests__/DistancesTab.dataTable.test.tsx`
Expected: FAIL — `Tests  6 failed | 3 passed (9)` (measured at plan time against the pre-migration tab) — the history test finds enabled controls (and `readOnly` is not yet a prop — a type error under `pnpm --filter studio typecheck`), and the menu/filter/centring assertions find today's single buttons, From/To boxes and left-aligned numbers.

- [ ] **Step 4: Implement — `DistancesTab.tsx`**

Replace the whole file `artifacts/studio/src/components/workspace/tabs/DistancesTab.tsx` with:

```bash
mkdir -p artifacts/studio/src/components/workspace/tabs && cat > artifacts/studio/src/components/workspace/tabs/DistancesTab.tsx <<'SCU_EOF'
import { useMemo, useRef, useState } from "react";
import { AlertTriangle, X } from "lucide-react";
import type { Scenario } from "@workspace/api-client-react";
import { useGetReferenceDistances, getGetReferenceDistancesQueryKey } from "@workspace/api-client-react";
import { roundForFile, type CanonicalUnit } from "@workspace/units";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { DataTable } from "@/components/data-table/DataTable";
import type { ColumnDef } from "@/components/data-table/types";
import { useEntityFileMenus } from "@/components/data-table/useEntityFileMenus";
import { EntityIdCell } from "@/components/tables/EntityIdCell";
import { useDisplayUnit } from "@/contexts/UnitContext";
import { useDistanceDraft } from "@/hooks/useDistanceDraft";
import { formatDistanceDisplay, stripGrouping } from "@/lib/formatDistanceDisplay";

export interface DistanceOverride {
  fromId: string;
  toId: string;
  distance: number;
  /** T1 (Input Map v2) — true when this row was auto-filled by the backend's
   * haversine normalizer (services/autoDistance.ts) rather than entered or
   * imported by the student. Matches distanceOverrideSchema's own optional
   * `estimated` field exactly. Purely a display flag — editing the distance
   * (see `commitOverride`) drops it, treating the edit as a confirmation. */
  estimated?: boolean;
}

interface DistancesTabProps {
  /** The scenario's CURRENT distanceOverrides array (localInputs draft) —
   * unlike Warehouses/Customers, there's no fixed baseline to enumerate
   * (B4.3's same reasoning for the distances export): this grid shows
   * exactly what the student has explicitly set, not a merged full dataset. */
  distanceOverrides: DistanceOverride[];
  /** The last-SAVED distanceOverrides array (savedInputsRef.current, read at
   * the Workspace.tsx call site) — diffed against `distanceOverrides` purely
   * to drive the changed-row highlight. Never written to. */
  savedDistanceOverrides: DistanceOverride[];
  /** Known warehouse ids (base dataset + any scenario-local addedWarehouses)
   * — used only for a cheap client-side existence check ("does this fromId
   * look resolvable"). B2.1's server-side precheck remains the authoritative
   * check the Solve flow actually gates on; this is a nice-to-have early
   * warning, not a duplicate of that authority. */
  warehouseIds: string[];
  customerIds: string[];
  onChange: (next: DistanceOverride[]) => void;
  /** Undefined while the scenario hasn't resolved yet — Upload/Download stay disabled until it has. */
  scenarioId?: number;
  /** Fired after a successful import apply, with the updated scenario — the caller (Workspace.tsx) refreshes its inputs draft from it. */
  onImportApplied?: (scenario: Scenario) => void;
  /** Phase 3.2, Task 4 — when set, scroll/highlight the row(s) referencing this entity id (the post-Save precheck toast's "jump to it" action). Cleared by the consumer after use — this component doesn't clear it itself. */
  focusEntityId?: string | null;
  /** Followup — scenario-local added entities' `id -> displayCode` map (Workspace.tsx builds this from addedWarehouses/addedCustomers). From/To cells look up through this for DISPLAY ONLY — the underlying stored fromId/toId (the uuid) stays the join key everywhere else (existence checks, edits, removal). Base dataset ids have no entry here and fall back to showing the raw id, unchanged. */
  displayCodeById?: Record<string, string>;
  /** B3 (Bundle 2.2) — the active model's id, used to fetch its reference-distance
   * matrix. Optional: absent (or `referenceCapable` false) means there is no
   * base×base matrix at all — the merged table becomes override-rows-only. */
  modelId?: string;
  /** B3 — mirrors `manifest.capabilities.supportsReferenceDistances` for the
   * active model. The reference fetch only fires when this is true AND
   * `modelId` is set — an unsupported model (e.g. Brazil) must never issue
   * the request (would 422 server-side). */
  referenceCapable?: boolean;
  /** B3 — base-dataset warehouse ids currently INACTIVE in the scenario's live
   * (unsaved) `localInputs` draft (status not potential/fixed-open). Purely a
   * view filter over the immutable reference matrix — never refetched, just
   * hides rows whose warehouse endpoint is presently inactive (unless the
   * pair carries a current or saved override — resolution #2/#3). */
  inactiveWarehouseIds?: string[];
  /** B3 — base-dataset customer ids currently EXCLUDED in the scenario's live
   * `localInputs` draft. Same filter semantics as `inactiveWarehouseIds`. */
  excludedCustomerIds?: string[];
  /** ch4-tab-city-labels — max-coverage-us-only — id -> {city, state}
   * (base dataset ∪ added entities), built by Workspace.tsx's
   * `chenLocationMapFromInputs` off the same `localInputs` draft this tab's
   * other props already read. Originally written when this model was
   * chens-cosmetics-cn's China dataset, where `state` was "" for every row
   * (formatCityState() rendered city-only, never a trailing ", "); the
   * US dataset swap (MIG-4) gives every row a real state, so this now
   * renders "City, ST" — formatCityState()'s blank-state fallback stays
   * only as a defensive no-op, not because any shipped row is blank. When
   * present, the From/To cells show the city as the primary label with the
   * id/displayCode as a mono sub-label (mirrors JadeDistancesTab.tsx).
   * Absent for every other model (undefined) -> unchanged id-only
   * rendering (Bundle 6.1 resolution #5's original "no city column"
   * design stays intact for p-median-us/brazil). */
  locationById?: Record<string, { city: string; state: string }>;
  /** T11 (workspace-fixups-2, item 2) — canonical id -> {city, state,
   * displayId} (base dataset ∪ scenario-local added entities), built by
   * Workspace.tsx's `buildEntityIdentityById(modelId, dataset, localInputs)`
   * — the LIVE draft, not the solved snapshot (an entity added/moved in the
   * current unsaved draft must show correct location + code immediately).
   * COMPATIBILITY RESOLVER: a cell prefers this map's entry, else falls back
   * to the existing `locationById`/`displayCodeById` sources, else the
   * canonical id — so leaving this prop unset (every pre-INT caller) is
   * byte-unchanged. The location-cell UPGRADE this map newly enables for a
   * currently bare-id pair (p-median-us/brazil, which never had
   * `locationById`) is additionally gated on the unfiltered row count
   * exceeding 10 (item 2's ">10 upgrade" rule) — Chen's existing
   * `locationById`-driven display already renders rich at every row count
   * and is never gated by this threshold. */
  identityById?: Record<string, { city: string; state: string; displayId: string }>;
  /** chen-bands-units, Task 12 — the active model's canonical distance unit
   * ("km" | "mi"), sourced from the manifest. `null`/undefined while it
   * hasn't resolved yet — there is NO fallback: every value/label below and
   * every editable cell stays gated (no number, no unit suffix, disabled
   * input) until this is authoritative (Part D, "No fallback unit"). Wired
   * by Workspace.tsx (Task 14); every pre-Task-14 caller omits it, which is
   * exactly the disabled/unresolved state, not a behavior regression for
   * those callers since none of them previously carried unit awareness. */
  canonicalUnit?: CanonicalUnit | null;
  /** SCU-2.P4.3 (D2) — browsing result history: every override cell, remove
   * button and the add-row trigger are disabled (the write was silently
   * dropped by Workspace's `updateInputsField` before). */
  readOnly?: boolean;
}

function pairKey(fromId: string, toId: string): string {
  return `${fromId}|${toId}`;
}

// chen-bands-units, Task 12 — one row's Override cell. A dedicated child
// component (not a hook called inline inside the parent's `.map()`) because
// `useDistanceDraft` must be called unconditionally, the same number of times
// on every render of ITS OWN component instance — the parent's row list
// changes shape across renders (pagination/filter/add/remove), which would
// violate the Rules of Hooks if the hook were invoked directly inside the
// parent's map callback. `currentValue` is undefined for a base row with no
// override yet (its own "revert to" baseline is genuinely blank, not a real
// canonical number) — text is forced blank whenever there's no override AND
// no in-progress draft, regardless of what baseline value the hook itself is
// keyed on.
function DistanceOverrideCell({
  canonicalUnit,
  currentValue,
  resetKey,
  onCommitValid,
  inputTestId,
  errorTestId,
  readOnly,
}: {
  canonicalUnit: CanonicalUnit | null;
  currentValue: number | undefined;
  resetKey: unknown;
  onCommitValid: (canonicalValue: number) => void;
  inputTestId: string;
  errorTestId: string;
  readOnly: boolean;
}) {
  const draft = useDistanceDraft({
    canonicalUnit,
    value: currentValue ?? 0,
    resetKey,
    presentation: "grouped",
    onCommit: v => {
      if (Number.isFinite(v) && v > 0) onCommitValid(v);
    },
  });
  const text = !draft.isDirty && currentValue == null ? "" : draft.text;

  // Live, as-you-type domain validation (positive-number business rule) —
  // deliberately independent of the unit-toggle grammar's own notion of
  // "complete" (e.g. "5." shows no error here, matching this field's
  // pre-existing whole-value `Number()` behavior; it just won't COMMIT on
  // blur/Enter until it becomes grammar-complete, per the hook's contract).
  // ch4-fixes item 4 — strip grouping BEFORE the numeric check: the idle text
  // is now formatted ("1,234.57") and `Number("1,234.57")` is NaN, which
  // would render a false "must be a positive number" on a perfectly valid
  // committed override.
  const trimmed = stripGrouping(text).trim();
  const numeric = trimmed === "" ? null : Number(trimmed);
  const error =
    trimmed !== "" && (numeric === null || Number.isNaN(numeric) || numeric <= 0) ? "Distance must be a positive number." : null;

  return (
    <div className="flex flex-col gap-0.5">
      {/* text (not type="number") — a native number input's own
          sanitization silently strips a malformed string like "12abc" to
          "" before onChange ever fires, which would make the whole-value
          Number()-vs-parseFloat distinction below unreachable/untestable. */}
      <Input
        type="text"
        inputMode="decimal"
        value={text}
        disabled={readOnly || draft.disabled}
        title={readOnly ? READ_ONLY_TITLE : undefined}
        onChange={e => draft.onChange(e.target.value)}
        onFocus={draft.onFocus}
        onBlur={draft.commit}
        onKeyDown={e => {
          if (e.key === "Enter") draft.commit();
          else if (e.key === "Escape") draft.discard();
        }}
        aria-invalid={error ? "true" : undefined}
        className={`h-7 text-xs w-full min-w-24 font-mono ${error ? "border-destructive" : ""}`}
        data-testid={inputTestId}
      />
      {error && (
        <p className="text-[11px] text-destructive mt-0.5" data-testid={errorTestId}>
          {error}
        </p>
      )}
    </div>
  );
}

const READ_ONLY_TITLE = "Read-only while browsing result history.";

// Bundle 6.1, T2 — one row of the merged base+override table. `base === null`
// means there's genuinely no reference pair for this (fromId, toId) — either
// it's a scenario-local added-entity pair, or the model has no reference
// matrix at all (referenceCapable false).
interface MergedRow {
  fromId: string;
  toId: string;
  base: number | null;
  override?: DistanceOverride;
}

// B5.1 — long-format `{fromId, toId, distance}` grid over scenario.inputs'
// distanceOverrides (B1.1), merged (Bundle 6.1, T2) with the model's
// read-only base×base reference matrix (B3) into ONE table: every base pair
// shows its reference distance plus an editable Override cell; added-entity
// pairs (no base counterpart) append with a "—" base.
// SCU-2.P4.3 (B2.1/B2.2) — rendered by the shared DataTable: the From/To
// boxes are gone (FilterMenu > 10 rows, column ids `from`/`to` keep the
// `input-filter-from`/`-to` testids inside the menu), the pager shows only
// above 50 filtered rows, numbers are centred, and every control is
// read-only while browsing history (D2).
export function DistancesTab({
  distanceOverrides,
  savedDistanceOverrides,
  warehouseIds,
  customerIds,
  onChange,
  scenarioId,
  onImportApplied,
  focusEntityId,
  displayCodeById,
  modelId,
  referenceCapable,
  inactiveWarehouseIds,
  excludedCustomerIds,
  locationById,
  identityById,
  canonicalUnit = null,
  readOnly = false,
}: DistancesTabProps) {
  const files = useEntityFileMenus({ entity: "distances", testIdEntity: "distances", modelId, scenarioId, onImportApplied });
  const [addingRow, setAddingRow] = useState(false);
  const [newFrom, setNewFrom] = useState("");
  const [newTo, setNewTo] = useState("");
  const [addError, setAddError] = useState<string | null>(null);

  const { effectiveUnit, toDisplay } = useDisplayUnit();
  const unit = canonicalUnit == null ? null : effectiveUnit(canonicalUnit);
  const unitSuffix = (label: string) => (unit ? `${label} (${unit})` : label);

  // The add-row Distance field (see `DistanceOverrideCell` for why the hook
  // is called unconditionally and why the committed value is read from a ref).
  const newDistanceCanonicalRef = useRef<number | null>(null);
  const newDistanceDraft = useDistanceDraft({
    canonicalUnit,
    value: 0,
    resetKey: scenarioId,
    onCommit: v => {
      newDistanceCanonicalRef.current = v;
    },
  });
  const newDistanceText = newDistanceDraft.isDirty ? newDistanceDraft.text : "";

  // B3 — fetched only for a model with a reference matrix (an unsupported
  // model would 422); `staleTime: Infinity`, the base matrix is immutable.
  const referenceEnabled = Boolean(referenceCapable && modelId);
  const referenceQuery = useGetReferenceDistances(modelId ?? "", {
    query: {
      enabled: referenceEnabled,
      staleTime: Infinity,
      queryKey: getGetReferenceDistancesQueryKey(modelId ?? ""),
    },
  });

  const warehouseIdSet = new Set(warehouseIds);
  const customerIdSet = new Set(customerIds);
  const inactiveWarehouseIdSet = useMemo(() => new Set(inactiveWarehouseIds ?? []), [inactiveWarehouseIds]);
  const excludedCustomerIdSet = useMemo(() => new Set(excludedCustomerIds ?? []), [excludedCustomerIds]);
  const referencePairs = referenceQuery.data?.pairs ?? [];

  const baseByKey = useMemo(() => new Map(referencePairs.map(p => [pairKey(p.fromId, p.toId), p])), [referencePairs]);
  const overrideByKey = useMemo(() => new Map(distanceOverrides.map(o => [pairKey(o.fromId, o.toId), o])), [distanceOverrides]);
  const savedByKey = useMemo(
    () => new Map(savedDistanceOverrides.map(o => [pairKey(o.fromId, o.toId), o])),
    [savedDistanceOverrides],
  );

  // Resolution #8 — the From/To filters match the display code (an added
  // entity's displayCode, else the id), never the raw uid.
  const displayValue = (id: string) => displayCodeById?.[id] ?? id;

  // Resolution #2/#3 — the effective rows (B2.2 pipeline step 1): a base pair
  // shows when active/included OR it carries a current or saved override;
  // added-entity pairs append after the base rows.
  const mergedRowsAll: MergedRow[] = useMemo(() => {
    const base: MergedRow[] = referencePairs
      .filter(p => {
        const k = pairKey(p.fromId, p.toId);
        const hasOverrideOrSaved = overrideByKey.has(k) || savedByKey.has(k);
        const passesStatus = !inactiveWarehouseIdSet.has(p.fromId) && !excludedCustomerIdSet.has(p.toId);
        return passesStatus || hasOverrideOrSaved;
      })
      .map(p => ({ fromId: p.fromId, toId: p.toId, base: p.distance, override: overrideByKey.get(pairKey(p.fromId, p.toId)) }));
    const added: MergedRow[] = distanceOverrides
      .filter(o => !baseByKey.has(pairKey(o.fromId, o.toId)))
      .map(o => ({ fromId: o.fromId, toId: o.toId, base: null, override: o }));
    return [...base, ...added];
  }, [referencePairs, distanceOverrides, baseByKey, overrideByKey, savedByKey, inactiveWarehouseIdSet, excludedCustomerIdSet]);

  // T11 (workspace-fixups-2, item 2) — compatibility resolver (unchanged).
  function resolvedLocation(id: string): { city: string; state: string } | undefined {
    const existing = locationById?.[id];
    if (existing) return existing;
    if (identityById && mergedRowsAll.length > 10) {
      const entry = identityById[id];
      if (entry && (entry.city || entry.state)) return { city: entry.city, state: entry.state };
    }
    return undefined;
  }
  function resolvedDisplayId(id: string): string {
    return identityById?.[id]?.displayId ?? displayCodeById?.[id] ?? id;
  }

  // Resolution #4 — changed vs SAVED, including a cleared-but-unsaved override.
  function isChangedRow(r: MergedRow): boolean {
    const saved = savedByKey.get(pairKey(r.fromId, r.toId));
    const current = r.override;
    if (!saved && !current) return false;
    if (!saved || !current) return true;
    return saved.distance !== current.distance;
  }

  function commitOverride(r: MergedRow, canonicalValue: number) {
    const key = pairKey(r.fromId, r.toId);
    const nextOverride: DistanceOverride = { fromId: r.fromId, toId: r.toId, distance: canonicalValue, estimated: undefined };
    onChange(
      overrideByKey.has(key)
        ? distanceOverrides.map(o => (pairKey(o.fromId, o.toId) === key ? nextOverride : o))
        : [...distanceOverrides, nextOverride],
    );
  }

  function clearOverride(r: MergedRow) {
    const key = pairKey(r.fromId, r.toId);
    onChange(distanceOverrides.filter(o => pairKey(o.fromId, o.toId) !== key));
  }

  // Resolution #6 + chen-bands-units Task 12 "no fallback unit" (unchanged).
  function baseCell(r: MergedRow) {
    if (canonicalUnit == null) {
      return <Spinner className="w-3 h-3" data-testid={`spinner-distance-unit-${r.fromId}-${r.toId}`} />;
    }
    if (referenceCapable) {
      if (referenceQuery.isLoading) {
        return <Spinner className="w-3 h-3" data-testid={`spinner-distance-base-${r.fromId}-${r.toId}`} />;
      }
      if (referenceQuery.isError) return "unavailable";
    }
    if (r.base == null) return "—";
    return formatDistanceDisplay(toDisplay(r.base, canonicalUnit));
  }

  // Filter values are in the DISPLAY unit — what the student reads in the cell.
  const displayNumber = (v: number | null | undefined) =>
    v == null || canonicalUnit == null ? null : toDisplay(v, canonicalUnit);

  // Rebuilt every render on purpose: the cells close over live props
  // (`onChange` is an inline arrow over Workspace's `updateInputsField`), and a
  // memoised copy would write through a stale closure. DataTable/FilterMenu
  // hold no effect keyed on the columns' identity, so this costs one cheap
  // descriptor derivation per render.
  const columns: ColumnDef<MergedRow>[] = [
    {
      id: "from",
      header: "From",
      kind: "text",
      filter: "text",
      value: r => displayValue(r.fromId),
      cellClassName: "text-xs",
      cell: r => (
        <div className="flex items-center gap-1">
          <EntityIdCell entityId={r.fromId} displayId={resolvedDisplayId(r.fromId)} location={resolvedLocation(r.fromId)} />
          {!warehouseIdSet.has(r.fromId) && (
            <span
              title="Unknown warehouse ID — not found in this scenario's warehouses"
              data-testid={`warning-unknown-from-${r.fromId}-${r.toId}`}
            >
              <AlertTriangle className="w-3 h-3 text-amber-600" />
            </span>
          )}
        </div>
      ),
    },
    {
      id: "to",
      header: "To",
      kind: "text",
      filter: "text",
      value: r => displayValue(r.toId),
      cellClassName: "text-xs",
      cell: r => (
        <div className="flex items-center gap-1">
          <EntityIdCell entityId={r.toId} displayId={resolvedDisplayId(r.toId)} location={resolvedLocation(r.toId)} />
          {!customerIdSet.has(r.toId) && (
            <span
              title="Unknown customer ID — not found in this scenario's customers"
              data-testid={`warning-unknown-to-${r.fromId}-${r.toId}`}
            >
              <AlertTriangle className="w-3 h-3 text-amber-600" />
            </span>
          )}
        </div>
      ),
    },
    {
      id: "base",
      header: unitSuffix("Base"),
      filterLabel: "Base",
      kind: "number",
      value: r => displayNumber(r.base),
      cellClassName: "font-mono text-xs",
      cell: r => baseCell(r),
    },
    {
      id: "override",
      header: unitSuffix("Override"),
      filterLabel: "Override",
      kind: "number",
      value: r => displayNumber(r.override?.distance),
      cell: r => {
        const changed = isChangedRow(r);
        return (
          <div className="flex items-center justify-center gap-1.5">
            <DistanceOverrideCell
              canonicalUnit={canonicalUnit}
              currentValue={r.override?.distance}
              // Discards a stale draft on scenario switch AND when this row's
              // override is cleared out from under it (the remove button).
              resetKey={`${scenarioId ?? ""}:${r.override ? "1" : "0"}`}
              onCommitValid={v => commitOverride(r, v)}
              inputTestId={`input-distance-${r.fromId}-${r.toId}`}
              errorTestId={`text-distance-error-${r.fromId}-${r.toId}`}
              readOnly={readOnly}
            />
            {r.override?.estimated && (
              <span
                className="text-[10px] text-sky-700 bg-sky-100 border border-sky-300 rounded px-1"
                data-testid={`badge-distance-estimated-${r.fromId}-${r.toId}`}
              >
                Estimated
              </span>
            )}
            {changed && (
              <span
                className="text-[10px] text-amber-700 bg-amber-100 border border-amber-300 rounded px-1"
                data-testid={`badge-distance-changed-${r.fromId}-${r.toId}`}
              >
                Changed
              </span>
            )}
          </div>
        );
      },
    },
    {
      id: "remove",
      header: "",
      kind: "text",
      filter: false,
      value: () => null,
      cell: r =>
        (r.override || r.base == null) && (
          <button
            type="button"
            aria-label={`Remove distance override ${r.fromId} → ${r.toId}`}
            onClick={() => clearOverride(r)}
            disabled={readOnly}
            title={readOnly ? READ_ONLY_TITLE : undefined}
            data-testid={`button-remove-distance-${r.fromId}-${r.toId}`}
            className="text-muted-foreground hover:text-destructive disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        ),
    },
  ];

  function handleAddRow() {
    const fromId = newFrom.trim();
    const toId = newTo.trim();
    // Resolve a pending typed value synchronously (see newDistanceCanonicalRef).
    newDistanceDraft.commit();
    const distance = newDistanceCanonicalRef.current;

    if (!fromId || !toId) {
      setAddError("From ID and To ID are both required.");
      return;
    }
    if (distance == null || !Number.isFinite(distance) || distance <= 0) {
      setAddError("Distance must be a positive number.");
      return;
    }
    if (distanceOverrides.some(o => o.fromId === fromId && o.toId === toId)) {
      setAddError("A distance override for this pair already exists — edit it in the table instead.");
      return;
    }

    setAddError(null);
    onChange([...distanceOverrides, { fromId, toId, distance }]);
    setNewFrom("");
    setNewTo("");
    newDistanceDraft.discard();
    newDistanceCanonicalRef.current = null;
    setAddingRow(false);
  }

  function cancelAddRow() {
    setAddingRow(false);
    setNewFrom("");
    setNewTo("");
    newDistanceDraft.discard();
    newDistanceCanonicalRef.current = null;
    setAddError(null);
  }

  const addRowUi = addingRow ? (
    <div className="flex items-start gap-1.5 mt-2" data-testid="add-distance-row-form">
      <Input
        placeholder="From ID (warehouse)"
        value={newFrom}
        onChange={e => setNewFrom(e.target.value)}
        className="h-7 text-xs w-36"
        data-testid="input-new-distance-from"
      />
      <Input
        placeholder="To ID (customer)"
        value={newTo}
        onChange={e => setNewTo(e.target.value)}
        className="h-7 text-xs w-36"
        data-testid="input-new-distance-to"
      />
      <Input
        type="text"
        inputMode="decimal"
        placeholder={unitSuffix("Distance")}
        value={newDistanceText}
        disabled={newDistanceDraft.disabled}
        onChange={e => newDistanceDraft.onChange(e.target.value)}
        onBlur={newDistanceDraft.commit}
        onKeyDown={e => {
          if (e.key === "Enter") newDistanceDraft.commit();
          else if (e.key === "Escape") newDistanceDraft.discard();
        }}
        className="h-7 text-xs w-24 font-mono"
        data-testid="input-new-distance-value"
      />
      <Button size="sm" className="h-7 px-2 text-xs" onClick={handleAddRow} data-testid="button-add-distance-confirm">
        Add
      </Button>
      <Button
        size="sm"
        variant="ghost"
        className="h-7 px-2 text-xs"
        onClick={cancelAddRow}
        data-testid="button-add-distance-cancel"
      >
        Cancel
      </Button>
    </div>
  ) : (
    <Button
      size="sm"
      variant="outline"
      className="h-7 px-2 text-xs mt-2"
      onClick={() => setAddingRow(true)}
      disabled={readOnly}
      title={readOnly ? READ_ONLY_TITLE : undefined}
      data-testid="button-add-distance-row"
    >
      + Add row
    </Button>
  );

  const table = (
    <DataTable<MergedRow>
      rows={mergedRowsAll}
      rowKey={r => pairKey(r.fromId, r.toId)}
      columns={columns}
      ctx={{ readOnly, demandEditable: false, isChanged: isChangedRow }}
      rowClassName={(r, ctx) => (ctx.isChanged(r) ? "bg-amber-50" : r.override?.estimated ? "bg-sky-50" : undefined)}
      testIds={{
        toolbar: "distances-tab-toolbar",
        row: r => `row-distance-${r.fromId}-${r.toId}`,
        pagerPrev: "button-distances-prev",
        pagerNext: "button-distances-next",
        pageIndicator: "distances-page-indicator",
        empty: "distances-tab-empty",
      }}
      toolbar={{ upload: files.upload, download: files.download }}
      scrollClassName="max-h-[55vh] overflow-y-auto"
      emptyState={
        <p className="text-sm text-muted-foreground">No distance overrides yet — add one below, or upload a CSV/JSON file.</p>
      }
      // Phase 3.2 Task 4 — the precheck toast's "jump to it": clear filters,
      // go to the target's page, scroll it into view. The row count is in the
      // token so a jump requested before the reference matrix loads re-runs
      // once it has (today's effect depended on the merged row list too).
      focus={
        focusEntityId
          ? {
              token: `${focusEntityId}|${mergedRowsAll.length}`,
              matches: r => r.fromId === focusEntityId || r.toId === focusEntityId,
            }
          : null
      }
    />
  );

  return (
    <div data-testid="distances-tab">
      {referenceCapable && referenceQuery.isError && (
        <p className="text-xs text-destructive mb-2" data-testid="distances-reference-error">
          Failed to load reference distances.
        </p>
      )}
      {referenceCapable && referenceQuery.isLoading && (
        <p className="text-xs text-muted-foreground mb-2" data-testid="distances-reference-loading">
          Loading reference distances…
        </p>
      )}
      {/* Compat wrapper: present exactly when the model has a base×base matrix. */}
      {referenceCapable ? <div data-testid="distances-reference-section">{table}</div> : table}
      {addRowUi}
      {addError && (
        <p className="text-[11px] text-destructive mt-1" data-testid="text-add-distance-error">
          {addError}
        </p>
      )}
      {files.dialog}
    </div>
  );
}
SCU_EOF
```

- [ ] **Step 5: Wire Workspace, flip the D2 guard, rewrite the by-design test breaks**

Adds `readOnly={isBrowsingHistoryNow}` to the `<DistancesTab` mount, flips the guard, rewrites `DistancesTab.test.tsx` by design (FilterMenu fixtures padded to 11 rows; Download/Upload via the menus; pager-only-above-50; delete resets to page 1):

```bash
python3 - <<'PY'
import pathlib
EDITS = [
    ('artifacts/studio/src/__tests__/DistancesTab.test.tsx',
     '''import { makeExportProviderValue } from "@/__tests__/helpers/renderWithExportProvider";
import { ExportProvider } from "@/contexts/ExportContext";

// Bundle 6.1, T2 — the two previously-separate sections (read-only reference''',
     '''import { makeExportProviderValue } from "@/__tests__/helpers/renderWithExportProvider";
import { ExportProvider } from "@/contexts/ExportContext";
import { chooseInputDownload, chooseUpload, filterText } from "@/__tests__/helpers/inputTable";

// Bundle 6.1, T2 — the two previously-separate sections (read-only reference'''),
    ('artifacts/studio/src/__tests__/DistancesTab.test.tsx',
     '''});

describe("DistancesTab — from/to filters", () => {
  it("filters visible rows by the from-id filter text", () => {
    renderWithQueryClient(
      <DistancesTab
        distanceOverrides={overrides}
        savedDistanceOverrides={overrides}
        warehouseIds={["WH01", "WH02"]}
        customerIds={["C001", "C002"]}''',
     '''});

// SCU-2.P4.3 (B2.2) — the From/To boxes are now the FilterMenu's `from`/`to`
// text controls, which only render above 10 rows: these fixtures carry 11.
const elevenOverrides = [
  ...overrides,
  ...Array.from({ length: 8 }, (_, i) => ({ fromId: "WH03", toId: `C${String(i + 10).padStart(3, "0")}`, distance: 200 + i })),
];

describe("DistancesTab — from/to filters", () => {
  it("filters visible rows by the from-id filter text", () => {
    renderWithQueryClient(
      <DistancesTab
        distanceOverrides={elevenOverrides}
        savedDistanceOverrides={elevenOverrides}
        warehouseIds={["WH01", "WH02"]}
        customerIds={["C001", "C002"]}'''),
    ('artifacts/studio/src/__tests__/DistancesTab.test.tsx',
     '''      />,
    );
    fireEvent.change(screen.getByTestId("input-filter-from"), { target: { value: "WH02" } });
    expect(screen.queryByTestId("row-distance-WH01-C001")).not.toBeInTheDocument();
    expect(screen.queryByTestId("row-distance-WH01-C002")).not.toBeInTheDocument();''',
     '''      />,
    );
    filterText("from", "WH02");
    expect(screen.queryByTestId("row-distance-WH01-C001")).not.toBeInTheDocument();
    expect(screen.queryByTestId("row-distance-WH01-C002")).not.toBeInTheDocument();'''),
    ('artifacts/studio/src/__tests__/DistancesTab.test.tsx',
     '''
  it("filters visible rows by the to-id filter text", () => {
    renderWithQueryClient(
      <DistancesTab
        distanceOverrides={overrides}
        savedDistanceOverrides={overrides}
        warehouseIds={["WH01", "WH02"]}
        customerIds={["C001", "C002"]}
        onChange={vi.fn()}
      />,''',
     '''
  it("filters visible rows by the to-id filter text", () => {
    renderWithQueryClient(
      <DistancesTab
        distanceOverrides={elevenOverrides}
        savedDistanceOverrides={elevenOverrides}
        warehouseIds={["WH01", "WH02"]}
        customerIds={["C001", "C002"]}
        onChange={vi.fn()}
      />,'''),
    ('artifacts/studio/src/__tests__/DistancesTab.test.tsx',
     '''      />,
    );
    fireEvent.change(screen.getByTestId("input-filter-to"), { target: { value: "C002" } });
    expect(screen.queryByTestId("row-distance-WH01-C001")).not.toBeInTheDocument();
    expect(screen.getByTestId("row-distance-WH01-C002")).toBeInTheDocument();''',
     '''      />,
    );
    filterText("to", "C002");
    expect(screen.queryByTestId("row-distance-WH01-C001")).not.toBeInTheDocument();
    expect(screen.getByTestId("row-distance-WH01-C002")).toBeInTheDocument();'''),
    ('artifacts/studio/src/__tests__/DistancesTab.test.tsx',
     '''
  it("filters are case-insensitive substring matches", () => {
    renderWithQueryClient(
      <DistancesTab
        distanceOverrides={overrides}
        savedDistanceOverrides={overrides}
        warehouseIds={["WH01", "WH02"]}
        customerIds={["C001", "C002"]}
        onChange={vi.fn()}
      />,''',
     '''
  it("filters are case-insensitive substring matches", () => {
    renderWithQueryClient(
      <DistancesTab
        distanceOverrides={elevenOverrides}
        savedDistanceOverrides={elevenOverrides}
        warehouseIds={["WH01", "WH02"]}
        customerIds={["C001", "C002"]}
        onChange={vi.fn()}
      />,'''),
    ('artifacts/studio/src/__tests__/DistancesTab.test.tsx',
     '''      />,
    );
    fireEvent.change(screen.getByTestId("input-filter-from"), { target: { value: "wh0" } });
    expect(screen.getByTestId("row-distance-WH01-C001")).toBeInTheDocument();
    expect(screen.getByTestId("row-distance-WH02-C001")).toBeInTheDocument();''',
     '''      />,
    );
    filterText("from", "wh0");
    expect(screen.getByTestId("row-distance-WH01-C001")).toBeInTheDocument();
    expect(screen.getByTestId("row-distance-WH02-C001")).toBeInTheDocument();'''),
    ('artifacts/studio/src/__tests__/DistancesTab.test.tsx',
     '''
  it("resolution #8: an added entity is found by typing its DISPLAY code (not its raw uid) into the From filter", () => {
    const uidOverrides = [{ fromId: "aw-1234", toId: "C001", distance: 55 }];
    renderWithQueryClient(
      <DistancesTab''',
     '''
  it("resolution #8: an added entity is found by typing its DISPLAY code (not its raw uid) into the From filter", () => {
    const uidOverrides = [{ fromId: "aw-1234", toId: "C001", distance: 55 }, ...elevenOverrides.slice(1)];
    renderWithQueryClient(
      <DistancesTab'''),
    ('artifacts/studio/src/__tests__/DistancesTab.test.tsx',
     '''      />,
    );
    fireEvent.change(screen.getByTestId("input-filter-from"), { target: { value: "WH-CO-DENVER" } });
    expect(screen.getByTestId("row-distance-aw-1234-C001")).toBeInTheDocument();

    fireEvent.change(screen.getByTestId("input-filter-from"), { target: { value: "aw-1234" } });
    expect(screen.queryByTestId("row-distance-aw-1234-C001")).not.toBeInTheDocument();
  });''',
     '''      />,
    );
    filterText("from", "WH-CO-DENVER");
    expect(screen.getByTestId("row-distance-aw-1234-C001")).toBeInTheDocument();

    filterText("from", "aw-1234");
    expect(screen.queryByTestId("row-distance-aw-1234-C001")).not.toBeInTheDocument();
  });'''),
    ('artifacts/studio/src/__tests__/DistancesTab.test.tsx',
     '''      />,
    );
    await waitFor(() => expect(screen.getByTestId("row-distance-WH01-C001")).toBeInTheDocument());

    await userEvent.click(screen.getByTestId("button-distances-next"));
    expect(screen.getByTestId("distances-page-indicator")).toHaveTextContent("Page 2 of");

    fireEvent.change(screen.getByTestId("input-filter-from"), { target: { value: "WH01" } });

    expect(screen.getByTestId("distances-page-indicator")).toHaveTextContent("Page 1 of");''',
     '''      />,
    );
    // The pager only renders above 50 rows (B2.2): wait for the base matrix.
    await waitFor(() => expect(screen.getByTestId("button-distances-next")).toBeInTheDocument());

    await userEvent.click(screen.getByTestId("button-distances-next"));
    expect(screen.getByTestId("distances-page-indicator")).toHaveTextContent("Page 2 of");

    filterText("from", "WH01");

    expect(screen.getByTestId("distances-page-indicator")).toHaveTextContent("Page 1 of");'''),
    ('artifacts/studio/src/__tests__/DistancesTab.test.tsx',
     '''    // Once the 5200-pair base matrix has loaded, the added row sorts after
    // all of it (page ~104) — filter down to it so it's on the current page.
    fireEvent.change(screen.getByTestId("input-filter-from"), { target: { value: "aw-1234" } });
    const row = screen.getByTestId("row-distance-aw-1234-C001");
    expect(row).toHaveTextContent("—");''',
     '''    // Once the 5200-pair base matrix has loaded, the added row sorts after
    // all of it (page ~104) — filter down to it so it's on the current page.
    filterText("from", "aw-1234");
    const row = screen.getByTestId("row-distance-aw-1234-C001");
    expect(row).toHaveTextContent("—");'''),
    ('artifacts/studio/src/__tests__/DistancesTab.test.tsx',
     '''    // matrix has loaded — filter down to it so it's actually on the current
    // page (this test is about its Base cell's content, not pagination).
    fireEvent.change(screen.getByTestId("input-filter-from"), { target: { value: "aw-1234" } });
    expect(screen.getByTestId("row-distance-aw-1234-C001")).toHaveTextContent("—");
  });''',
     '''    // matrix has loaded — filter down to it so it's actually on the current
    // page (this test is about its Base cell's content, not pagination).
    filterText("from", "aw-1234");
    expect(screen.getByTestId("row-distance-aw-1234-C001")).toHaveTextContent("—");
  });'''),
    ('artifacts/studio/src/__tests__/DistancesTab.test.tsx',
     '''      { scenarioId: null },
    );
    expect(screen.getByTestId("button-export-distances-csv")).toBeDisabled();
    expect(screen.getByTestId("button-export-distances-json")).toBeDisabled();
    expect(screen.getByTestId("button-import-distances")).toBeDisabled();
  });''',
     '''      { scenarioId: null },
    );
    // SCU-2.P4.3 (B2.3/B2.4) — one Download ▾ trigger now carries the disabled state.
    expect(screen.getByTestId("button-download-distances")).toBeDisabled();
    expect(screen.getByTestId("button-import-distances")).toBeDisabled();
  });'''),
    ('artifacts/studio/src/__tests__/DistancesTab.test.tsx',
     '''    );

    await userEvent.click(screen.getByTestId("button-export-distances-csv"));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());''',
     '''    );

    chooseInputDownload("distances", "csv");

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());'''),
    ('artifacts/studio/src/__tests__/DistancesTab.test.tsx',
     '''
    expect(screen.queryByText("Import distances")).not.toBeInTheDocument();
    await userEvent.click(screen.getByTestId("button-import-distances"));
    expect(screen.getByText("Import distances")).toBeInTheDocument();
    expect(screen.getByTestId("input-import-file-distances")).toBeInTheDocument();''',
     '''
    expect(screen.queryByText("Import distances")).not.toBeInTheDocument();
    chooseUpload("distances", "csv");
    expect(screen.getByText("Import distances")).toBeInTheDocument();
    expect(screen.getByTestId("input-import-file-distances")).toBeInTheDocument();'''),
    ('artifacts/studio/src/__tests__/DistancesTab.test.tsx',
     '    );\n\n    await userEvent.click(screen.getByTestId("button-import-distances"));\n    const file = new File(["fromId,toId,distance\\nWH01,C001,120.5"], "distances.csv", { type: "text/csv" });\n    await userEvent.upload(screen.getByTestId("input-import-file-distances"), file);',
     '    );\n\n    chooseUpload("distances", "csv");\n    const file = new File(["fromId,toId,distance\\nWH01,C001,120.5"], "distances.csv", { type: "text/csv" });\n    await userEvent.upload(screen.getByTestId("input-import-file-distances"), file);'),
    ('artifacts/studio/src/__tests__/DistancesTab.test.tsx',
     '''  });

  it("clamps down on delete: removing the last row on the last page lands on the new last page (no empty page)", async () => {
    const many = buildManyOverrides(101); // 3 pages: 50/50/1
    const Wrapper = () => {''',
     '''  });

  // SCU-2.P4.3 (spec B2.2 rev 4) — deleting a row changes the row set, which
  // resets to page 1 (was: clamp to the new last page).
  it("deleting a row resets to page 1 of the new page count", async () => {
    const many = buildManyOverrides(101); // 3 pages: 50/50/1
    const Wrapper = () => {'''),
    ('artifacts/studio/src/__tests__/DistancesTab.test.tsx',
     '''    await userEvent.click(screen.getByTestId(`button-remove-distance-${last.fromId}-${last.toId}`));

    expect(screen.getByTestId("distances-page-indicator")).toHaveTextContent("Page 2 of 2");
  });
''',
     '''    await userEvent.click(screen.getByTestId(`button-remove-distance-${last.fromId}-${last.toId}`));

    expect(screen.getByTestId("distances-page-indicator")).toHaveTextContent("Page 1 of 2");
  });
'''),
    ('artifacts/studio/src/__tests__/DistancesTab.test.tsx',
     '''
    // Set a non-empty filter first (real user typing — resets to page 1).
    fireEvent.change(screen.getByTestId("input-filter-from"), { target: { value: "WH01" } });
    expect(screen.getByTestId("distances-page-indicator")).toHaveTextContent("Page 1 of");

    // override #75 (index 74) — target its toId so the effect finds it.''',
     '''
    // Set a non-empty filter first (real user typing — resets to page 1).
    filterText("from", "WH01");
    // 5 matching rows: below the 50-row pager threshold (B2.2), so no pager.
    expect(screen.queryByTestId("distances-page-indicator")).not.toBeInTheDocument();

    // override #75 (index 74) — target its toId so the effect finds it.'''),
    ('artifacts/studio/src/pages/Workspace.tsx',
     '''        <DistancesTab
''',
     '''        <DistancesTab
          readOnly={isBrowsingHistoryNow}
'''),
    ('artifacts/studio/src/__tests__/historyReadOnlyTabs.test.ts',
     '''  DistancesTab: "pending", // SCU-2.P4.3''',
     '''  DistancesTab: "readOnly", // SCU-2.P4.3'''),
]
for path, old, new in EDITS:
    f = pathlib.Path(path)
    s = f.read_text()
    n = s.count(old)
    if n != 1:
        raise SystemExit(f'STOP: {path}: anchor found {n} times (expected 1): {old[:80]!r}')
    f.write_text(s.replace(old, new, 1))
print(f'applied {len(EDITS)} edits')
PY
```

Delete the P1.5 replica now, before any suite runs (deviation 16):

```bash
git rm artifacts/studio/src/__tests__/DataTable.distancesReplica.test.tsx
```

- [ ] **Step 6: Run the task's tests**

Run: `pnpm --filter studio exec vitest run src/__tests__/DistancesTab.dataTable.test.tsx src/__tests__/DistancesTab.test.tsx src/__tests__/historyReadOnlyTabs.test.ts`
Expected: PASS — 86 tests in 3 files (measured at plan time). Then `pnpm --filter studio typecheck` → exit 0.

- [ ] **Step 7: e2e sweep, rewrites and local run**

Sweep (matrix §3 prefixes for this instance; `labs.spec.ts` excluded):
```bash
grep -rn -E 'input-filter-(from|to)|distances-page-indicator|button-distances-(prev|next)|button-export-distances|button-import-distances|row-distance-|input-distance-|badge-distance-|button-add-distance|input-new-distance' artifacts/studio/e2e --include='*.ts' | grep -v labs.spec.ts
```
Rewritten below: every `input-filter-from/to` `.fill` on the Distances tab, the "Page 1 of 1" assert, the export/import buttons; new: Upload ▾ disabled with the Download reason in the history block (user answer 2026-10-17). Unchanged and still valid: page indicator / prev / next on the 5,200-row matrix (still > 50), `row-distance-*`, `input-distance-*`, `badge-distance-*`, the add-row ids (inline add stays), `delivery-teaching.spec.ts`'s unrelated `input-distance-threshold`, and the other tables' `input-filter-*` lines (their own tasks). New: the P1 hand-off focus-jump test in `input-map-v2.spec.ts` (`toBeInViewport`).

Apply the rewrites (each anchor is asserted unique; verified against the Bundle 1 tip `e2e/` tree and type-checked at plan time):

```bash
python3 - <<'PY'
import pathlib
EDITS = [
    ('artifacts/studio/e2e/bundle5-homepage-distances.spec.ts',
     '''import { test, expect, type Page } from "./fixtures";
''',
     '''import { test, expect, type Page } from "./fixtures";
import { closePopover, fillTableFilter } from "./helpers/inputTable";
'''),
    ('artifacts/studio/e2e/bundle5-homepage-distances.spec.ts',
     '''      await page.getByTestId("input-filter-from").fill(warehouseIds[0]);
      await expect(pageIndicator).toHaveText("Page 1 of 4");''',
     '''      // SCU-2.P4.3 (B2.2) — the From/To boxes are FilterMenu text controls now.
      await fillTableFilter(page, "from", warehouseIds[0]);
      await expect(pageIndicator).toHaveText("Page 1 of 4");'''),
    ('artifacts/studio/e2e/bundle5-homepage-distances.spec.ts',
     '''      await page.getByTestId("input-filter-to").fill(toFilterId);
      await expect(pageIndicator).toHaveText("Page 1 of 1");''',
     '''      await fillTableFilter(page, "to", toFilterId);
      // One matching row: the pager renders only above 50 filtered rows (B2.2).
      await expect(pageIndicator).toHaveCount(0);
      await closePopover(page);'''),
    ('artifacts/studio/e2e/bundle6.1-legend-distances.spec.ts',
     '''import { test, expect, type Page } from "./fixtures";
''',
     '''import { test, expect, type Page } from "./fixtures";
import { closePopover, fillTableFilter } from "./helpers/inputTable";
'''),
    ('artifacts/studio/e2e/bundle6.1-legend-distances.spec.ts',
     '''      await page.getByTestId("input-filter-from").fill(warehouseId);
      await page.getByTestId("input-filter-to").fill(customerId);''',
     '''      // SCU-2.P4.3 (B2.2) — FilterMenu text controls replace the From/To boxes.
      await fillTableFilter(page, "from", warehouseId);
      await fillTableFilter(page, "to", customerId);
      await closePopover(page);'''),
    ('artifacts/studio/e2e/chen-bands-units-qa.spec.ts',
     '''import { readSolvedAt } from "./helpers/solvedAt";
''',
     '''import { readSolvedAt } from "./helpers/solvedAt";
import { closePopover, fillTableFilter } from "./helpers/inputTable";
'''),
    ('artifacts/studio/e2e/chen-bands-units-qa.spec.ts',
     '''      await page.getByTestId("input-filter-from").fill("ALN");
      await page.getByTestId("input-filter-to").fill("C4");''',
     '''      await fillTableFilter(page, "from", "ALN");
      await fillTableFilter(page, "to", "C4");
      await closePopover(page);'''),
    ('artifacts/studio/e2e/chen-bands-units-qa.spec.ts',
     '''      await expect(page.getByTestId("button-export-distances-csv")).toBeDisabled({ timeout: HEADER_TIMEOUT });
      await expect(page.getByTestId("button-export-distances-csv")).toHaveAttribute(''',
     '''      // SCU-2.P4.3 (B2.4) — the Download ▾ trigger carries the disabled state + reason.
      await expect(page.getByTestId("button-download-distances")).toBeDisabled({ timeout: HEADER_TIMEOUT });
      await expect(page.getByTestId("button-download-distances")).toHaveAttribute('''),
    ('artifacts/studio/e2e/chen-bands-units-qa.spec.ts',
     '''      await expect(page.getByTestId("button-export-distances-csv")).toBeEnabled();''',
     '''      await expect(page.getByTestId("button-download-distances")).toBeEnabled();'''),
    ('artifacts/studio/e2e/chen-bands-units-qa.spec.ts',
     '''        page.getByTestId("button-export-distances-csv").click(),
      ]);
      expect(reqMi.url()).toContain("unit=mi");''',
     '''        (async () => {
          await page.getByTestId("button-download-distances").click();
          await page.getByTestId("button-export-distances-csv").click();
        })(),
      ]);
      expect(reqMi.url()).toContain("unit=mi");'''),
    ('artifacts/studio/e2e/chen-bands-units-qa.spec.ts',
     '''        page.getByTestId("button-export-distances-csv").click(),
      ]);
      expect(reqKm.url()).toContain("unit=km");''',
     '''        (async () => {
          await page.getByTestId("button-download-distances").click();
          await page.getByTestId("button-export-distances-csv").click();
        })(),
      ]);
      expect(reqKm.url()).toContain("unit=km");'''),
    ('artifacts/studio/e2e/max-coverage.spec.ts',
     '''import { readSolvedAt } from "./helpers/solvedAt";
''',
     '''import { readSolvedAt } from "./helpers/solvedAt";
import { chooseMenuItem, closePopover, fillTableFilter } from "./helpers/inputTable";
'''),
    ('artifacts/studio/e2e/max-coverage.spec.ts',
     '''      await page.getByTestId("input-filter-from").fill(newWhCode);''',
     '''      await fillTableFilter(page, "from", newWhCode);'''),
    ('artifacts/studio/e2e/max-coverage.spec.ts',
     '''      await page.getByTestId("input-filter-from").fill("");''',
     '''      await fillTableFilter(page, "from", "");
      await closePopover(page);'''),
    ('artifacts/studio/e2e/max-coverage.spec.ts',
     '''      await page.getByTestId("button-import-distances").click();''',
     '''      // SCU-2.P4.3 (B2.3) — Upload ▾ → CSV.
      await chooseMenuItem(page, "button-import-distances", "button-import-distances-csv");'''),
    ('artifacts/studio/e2e/input-map-v2.spec.ts',
     '''import { test, expect, type Page, type Locator } from "./fixtures";
''',
     '''import { test, expect, type Page, type Locator } from "./fixtures";
import { closePopover, fillTableFilter } from "./helpers/inputTable";
'''),
    ('artifacts/studio/e2e/input-map-v2.spec.ts',
     '''test.describe("Input Map v2 — money path (p-median-us)", () => {''',
     '// SCU-2.P4.3 — P1 hand-off (Codex finding 6): jsdom proves only that the\n// focus jump picks the right page; this proves the row is really scrolled into\n// view in a browser, with a filter active beforehand that the jump must clear.\ntest.describe("Distances focus jump on DataTable (SCU-2.P4.3, p-median-us)", () => {\n  test("the estimated-distance toast\'s jump clears an active filter, pages to the new warehouse and scrolls it into view", async ({ page }) => {\n    test.setTimeout(120_000);\n    await registerAndGoHome(page);\n    const id = await createPMedianScenario(page);\n    try {\n      const canvas = mapCanvas(page);\n      const box = (await canvas.boundingBox())!;\n      await canvas.click({ position: emptyMapOffset(box), button: "right" });\n      await page.getByTestId("map-add-menu-wh").click();\n      await expect(page.getByTestId("create-entity-dialog")).toBeVisible();\n      const displayCode = (await page.getByTestId("create-entity-display-code").textContent())!.trim();\n      await page.getByTestId("create-entity-submit").click();\n      await expect(page.getByTestId("create-entity-dialog")).not.toBeVisible();\n\n      // Unsaved draft carries across tabs: open Distances and filter everything out.\n      await page.getByTestId("sidebar-input-distances").click();\n      await expect(page.getByTestId("distances-tab")).toBeVisible({ timeout: HEADER_TIMEOUT });\n      await fillTableFilter(page, "from", "zz-no-such-warehouse");\n      await closePopover(page);\n      await expect(page.locator(\'[data-testid^="row-distance-"]\')).toHaveCount(0);\n\n      await page.getByTestId("button-save").click({ timeout: HEADER_TIMEOUT });\n      const escapedCode = displayCode.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&");\n      const toastItem = page.getByRole("region").locator("li").filter({\n        hasText: new RegExp(`distances? estimated for ${escapedCode}`),\n      });\n      await expect(toastItem).toBeVisible({ timeout: HEADER_TIMEOUT });\n      await toastItem.getByRole("button", { name: "Distances" }).click();\n\n      // The filter was cleared…\n      await page.getByTestId("button-filter-menu-trigger").click({ timeout: HEADER_TIMEOUT });\n      await expect(page.getByTestId("input-filter-from")).toHaveValue("");\n      await closePopover(page);\n      // …the pager moved off page 1 (the added warehouse\'s rows follow all 5,200 base pairs)…\n      await expect(page.getByTestId("distances-page-indicator")).not.toHaveText(/^Page 1 of/, { timeout: HEADER_TIMEOUT });\n      // …and the target row is actually on screen.\n      const target = page.locator(\'tr:has([data-testid^="badge-distance-estimated-"])\').first();\n      await expect(target).toBeInViewport({ timeout: HEADER_TIMEOUT });\n    } finally {\n      await page.request.delete(`/api/scenarios/${id}`);\n    }\n  });\n});\n\ntest.describe("Input Map v2 — money path (p-median-us)", () => {'),
    ('artifacts/studio/e2e/chen-bands-units-qa.spec.ts',
     '''      await expect(page.getByTestId("button-download-distances")).toHaveAttribute(
        "title",
        "Input exports reflect the current scenario",
      );''',
     '''      await expect(page.getByTestId("button-download-distances")).toHaveAttribute(
        "title",
        "Input exports reflect the current scenario",
      );
      // User decision 2026-10-17 — Upload ▾ is disabled in history too, same reason.
      await expect(page.getByTestId("button-import-distances")).toBeDisabled();
      await expect(page.getByTestId("button-import-distances")).toHaveAttribute(
        "title",
        "Input exports reflect the current scenario",
      );'''),
]
for path, old, new in EDITS:
    f = pathlib.Path(path)
    s = f.read_text()
    n = s.count(old)
    if n != 1:
        raise SystemExit(f'STOP: {path}: anchor found {n} times (expected 1): {old[:80]!r}')
    f.write_text(s.replace(old, new, 1))
print(f'applied {len(EDITS)} edits')
PY
```

Then `pnpm --filter studio typecheck:e2e` (exit 0) and, with both local servers up (Global Constraints), run
```bash
cd artifacts/studio && E2E_BASE_URL=http://localhost:5179 npx playwright test e2e/bundle5-homepage-distances.spec.ts e2e/bundle6.1-legend-distances.spec.ts e2e/chen-bands-units-qa.spec.ts e2e/max-coverage.spec.ts e2e/input-map-v2.spec.ts
```
Expected: every test passes (a failure → flake registry by test name, two isolated re-runs, before calling it a regression). Record per-spec pass/fail in the changelog entry.

- [ ] **Step 8: Gate**

Run each separately (Global Constraints):
1. `cnt=$(ps aux | grep "[v]itest" | grep -v "zsh -c" | wc -l | tr -d ' '); [ "$cnt" = "0" ]`
2. `pnpm run typecheck`
3. `pnpm --filter studio typecheck:e2e`
4. `DATABASE_URL="postgresql://shubhamkr@localhost:5432/nos_dev" pnpm --filter api-server test`
5. `pnpm --filter studio test`
6. `(cd artifacts/api-server/src/solver && python3 -m pytest tests/ -x)`
7. `pnpm --filter @workspace/import-schema test`

Expected: every command exits 0. Then `git diff --stat "$P3_TIP"..HEAD -- artifacts/api-server lib/db lib/api-spec` prints nothing.

- [ ] **Step 9: Changelog**

Append to the bottom of `docs/CHANGELOG-implementation.md`:

```markdown

### SCU-2.P4.3 — Distances on DataTable

- `DistancesTab` on DataTable: FilterMenu replaces From/To (`from`/`to` = display code, + Base/Override ranges); pager > 50 only; Upload ▾/Download ▾ + expected fields; history read-only (D2: override, remove, + Add row); numbers centred; focus via DataTable (`token` = id + row count).
- P1.5 replica test deleted (deviation 16). Real-browser focus check added (input-map-v2: filter cleared, page ≠ 1, row `toBeInViewport`).
- Deviations 3, 4, 5, 6, 7, 15, 16, 17.
- Gate: studio <N passed>, api-server <N passed>, pytest <N passed>, import-schema <N passed>. e2e (local, `E2E_BASE_URL` set): <spec: pass/fail per spec>.
```

Replace each `<…>` with the value measured in this run, or the literal `unknown`.

- [ ] **Step 10: Commit**

```bash
git add artifacts/studio/src/__tests__/DistancesTab.dataTable.test.tsx
```

```bash
[ "$(git rev-parse --abbrev-ref HEAD)" != "main" ] || exit 1
```

```bash
git commit artifacts/studio/src/__tests__/DistancesTab.dataTable.test.tsx artifacts/studio/src/components/workspace/tabs/DistancesTab.tsx artifacts/studio/src/__tests__/DistancesTab.test.tsx artifacts/studio/src/pages/Workspace.tsx artifacts/studio/src/__tests__/historyReadOnlyTabs.test.ts artifacts/studio/e2e/bundle5-homepage-distances.spec.ts artifacts/studio/e2e/bundle6.1-legend-distances.spec.ts artifacts/studio/e2e/chen-bands-units-qa.spec.ts artifacts/studio/e2e/max-coverage.spec.ts artifacts/studio/e2e/input-map-v2.spec.ts artifacts/studio/src/__tests__/DataTable.distancesReplica.test.tsx docs/CHANGELOG-implementation.md -m "[SCU-2.P4.3] move Distances onto DataTable" -m "FilterMenu replaces From/To, pager >50, Upload/Download menus, D2 read-only, numbers centred, focus via DataTable + browser viewport check. Replica test retired (dev 16). Deviations 3-7, 15-17." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task SCU-2.P4.4: Leg Distances on DataTable (two-echelon-gold-au)

**Owner role:** frontend-engineer. **Matrix:** §1 #11, §2b LegDistances. **Spec:** B2.1–B2.4, D2. **Deviations:** 3, 6, 7, 15, 17.

**Files:**
- Create: `artifacts/studio/src/__tests__/LegDistancesTab.dataTable.test.tsx`
- Modify: `artifacts/studio/src/components/workspace/tabs/LegDistancesTab.tsx`
- Modify: `artifacts/studio/src/__tests__/LegDistancesTab.test.tsx`
- Modify: `artifacts/studio/src/pages/Workspace.tsx`
- Modify: `artifacts/studio/src/__tests__/historyReadOnlyTabs.test.ts`
- Modify: `docs/CHANGELOG-implementation.md` (append `### SCU-2.P4.4`)

**Interfaces:**
- Consumes: as P4.3; `LEG_LABEL`/`legFor` (unchanged).
- Produces: `LegDistancesTab` prop `readOnly?: boolean`; new pager ids `button-legdistances-prev/next`, `legdistances-page-indicator` (above 50 rows).

**Behaviour changes (record each in the changelog):**
- From/To boxes → FilterMenu (`from`/`to` raw-id text, `leg` select, `distance` range).
- Pager above 50 rows (there was none — every row rendered).
- Focus jump now also clears filters and pages (was scroll-only).
- Upload ▾ / Download ▾; history read-only (D2); numbers centred.

- [ ] **Step 0: Invoke the simplicity skills**

Skill tool: `andrej-karpathy-skills:karpathy-guidelines`, then `ponytail:ponytail`. Record in the report that both ran (hard rule #12).

- [ ] **Step 1: Preconditions**

Run each line alone (worktree root):
```bash
cd /Users/shubhamkr/nos-scu-2.p4.4 && git rev-parse --abbrev-ref HEAD
git merge-base --is-ancestor "$BASE" HEAD || exit 1
git merge-base --is-ancestor "$B1_TIP" HEAD || exit 1
git merge-base --is-ancestor "$P3_TIP" HEAD || exit 1
test -f artifacts/studio/src/components/data-table/DataTable.tsx && test -f artifacts/studio/src/components/data-table/DownloadMenu.tsx && test -d lib/import-schema || exit 1
pnpm install --frozen-lockfile
```
Then confirm the files this task replaces wholesale are still the `46d2f98` text (Global Constraints):
```bash
git diff --quiet 46d2f98 HEAD -- artifacts/studio/src/components/workspace/tabs/LegDistancesTab.tsx || { echo 'STOP: artifacts/studio/src/components/workspace/tabs/LegDistancesTab.tsx changed since 46d2f98'; exit 1; }
```

- [ ] **Step 2: Write the failing test**

Create `artifacts/studio/src/__tests__/LegDistancesTab.dataTable.test.tsx`:

```bash
mkdir -p artifacts/studio/src/__tests__ && cat > artifacts/studio/src/__tests__/LegDistancesTab.dataTable.test.tsx <<'SCU_EOF'
// SCU-2.P4.4 — LegDistancesTab (two-echelon-gold-au) on the shared DataTable
// (spec B2.1–B2.4, D2): matrix testids, leg filter, history read-only, amber
// changed rows, centred numbers, focus jump, one edit round-trip.

import { useState, type ReactNode } from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AllProviders } from "@/__tests__/helpers/renderWithExportProvider";
import { LegDistancesTab, type LegDistanceOverride } from "@/components/workspace/tabs/LegDistancesTab";

function Providers({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={client}>
      <AllProviders>{children}</AllProviders>
    </QueryClientProvider>
  );
}

const mineIds = ["kalgoorlie"];
const refineryIds = ["daggar-hills", "cunnamulla"];
const customerIds = ["sydney", "melbourne", ...Array.from({ length: 10 }, (_, i) => `town-${i}`)];
// 12 rows: 1 mine→refinery, 11 refinery→customer; the last is unsaved (Changed).
const rows: LegDistanceOverride[] = [
  { fromId: "kalgoorlie", toId: "daggar-hills", distance: 293.7 },
  { fromId: "cunnamulla", toId: "sydney", distance: 610.5 },
  { fromId: "daggar-hills", toId: "melbourne", distance: 2019.2 },
  ...Array.from({ length: 9 }, (_, i) => ({ fromId: "cunnamulla", toId: `town-${i}`, distance: 100 + i })),
];
const saved = rows.slice(0, 11);

function renderTab(props: Partial<React.ComponentProps<typeof LegDistancesTab>> = {}) {
  return render(
    <LegDistancesTab
      distanceOverrides={rows}
      savedDistanceOverrides={saved}
      mineIds={mineIds}
      refineryIds={refineryIds}
      customerIds={customerIds}
      onChange={vi.fn()}
      canonicalUnit="km"
      scenarioId={1}
      {...props}
    />,
    { wrapper: Providers },
  );
}

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

describe("LegDistancesTab on DataTable (SCU-2.P4.4)", () => {
  it("emits every testid in the matrix map", () => {
    renderTab();
    for (const id of [
      "legdistances-tab",
      "legdistances-tab-toolbar",
      "button-import-legdistances",
      "button-download-legdistances",
      "button-filter-menu-trigger",
      "row-legdistance-kalgoorlie-daggar-hills",
      "badge-leg-kalgoorlie-daggar-hills",
      "input-legdistance-kalgoorlie-daggar-hills",
      "button-remove-legdistance-kalgoorlie-daggar-hills",
      "badge-legdistance-changed-cunnamulla-town-8",
      "button-add-legdistance-row",
    ]) {
      expect(screen.getByTestId(id)).toBeInTheDocument();
    }
    expect(screen.getByTestId("badge-leg-kalgoorlie-daggar-hills")).toHaveTextContent("Mine → Refinery");
    fireEvent.click(screen.getByTestId("button-download-legdistances"));
    expect(screen.getByTestId("button-export-legdistances-csv")).toBeInTheDocument();
    expect(screen.getByTestId("button-export-legdistances-json")).toBeInTheDocument();
  });

  it("empty state keeps its testid and the add trigger", () => {
    renderTab({ distanceOverrides: [], savedDistanceOverrides: [] });
    expect(screen.getByTestId("legdistances-tab-empty")).toHaveTextContent("No leg distance overrides yet");
    expect(screen.getByTestId("button-add-legdistance-row")).toBeInTheDocument();
    expect(screen.queryByTestId("button-filter-menu-trigger")).toBeNull();
  });

  it("the Leg column filters as a select over its labels", () => {
    renderTab();
    fireEvent.click(screen.getByTestId("button-filter-menu-trigger"));
    fireEvent.click(screen.getByTestId("checkbox-filter-leg-Mine → Refinery"));
    expect(screen.getByTestId("row-legdistance-kalgoorlie-daggar-hills")).toBeInTheDocument();
    expect(screen.queryByTestId("row-legdistance-cunnamulla-sydney")).toBeNull();
  });

  it("numbers centred; amber on the changed row only", () => {
    renderTab();
    const headers = within(screen.getByTestId("legdistances-tab")).getAllByRole("columnheader");
    expect(headers.map(h => h.textContent)).toEqual(["Leg", "From", "To", "Distance (km)", ""]);
    expect(headers[3]).toHaveClass("text-center");
    expect(screen.getByTestId("row-legdistance-cunnamulla-town-8")).toHaveClass("bg-amber-50");
    expect(screen.getByTestId("row-legdistance-cunnamulla-sydney")).not.toHaveClass("bg-amber-50");
  });

  it("history read-only (D2): value inputs, remove buttons and the add trigger are disabled", () => {
    renderTab({ readOnly: true });
    expect(screen.getByTestId("input-legdistance-cunnamulla-sydney")).toBeDisabled();
    expect(screen.getByTestId("button-remove-legdistance-cunnamulla-sydney")).toBeDisabled();
    expect(screen.getByTestId("button-add-legdistance-row")).toBeDisabled();
  });

  it("focus jump clears an active filter and scrolls the row into view", () => {
    const { rerender } = renderTab();
    fireEvent.click(screen.getByTestId("button-filter-menu-trigger"));
    fireEvent.change(screen.getByTestId("input-filter-from"), { target: { value: "kalgoorlie" } });
    expect(screen.queryByTestId("row-legdistance-cunnamulla-sydney")).toBeNull();
    rerender(
      <LegDistancesTab
        distanceOverrides={rows}
        savedDistanceOverrides={saved}
        mineIds={mineIds}
        refineryIds={refineryIds}
        customerIds={customerIds}
        onChange={vi.fn()}
        canonicalUnit="km"
        scenarioId={1}
        focusEntityId="sydney"
      />,
    );
    expect(screen.getByTestId("input-filter-from")).toHaveValue("");
    expect(screen.getByTestId("row-legdistance-cunnamulla-sydney")).toBeInTheDocument();
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
  });

  it("edit round-trip through a stateful parent", () => {
    function Parent() {
      const [r, setR] = useState(rows.slice(0, 3));
      return (
        <LegDistancesTab
          distanceOverrides={r}
          savedDistanceOverrides={rows.slice(0, 3)}
          mineIds={mineIds}
          refineryIds={refineryIds}
          customerIds={customerIds}
          onChange={setR}
          canonicalUnit="km"
        />
      );
    }
    render(<Parent />, { wrapper: Providers });
    const input = screen.getByTestId("input-legdistance-cunnamulla-sydney");
    fireEvent.change(input, { target: { value: "700" } });
    fireEvent.blur(input);
    expect(screen.getByTestId("input-legdistance-cunnamulla-sydney")).toHaveValue("700");
    expect(screen.getByTestId("row-legdistance-cunnamulla-sydney")).toHaveClass("bg-amber-50");
  });
});
SCU_EOF
```

- [ ] **Step 3: Run it to verify it fails**

Run: `pnpm --filter studio exec vitest run src/__tests__/LegDistancesTab.dataTable.test.tsx`
Expected: FAIL — `Tests  5 failed | 2 passed (7)` (measured at plan time against the pre-migration tab) — the history test finds enabled controls (and `readOnly` is not yet a prop — a type error under `pnpm --filter studio typecheck`), and the menu/filter/centring assertions find today's single buttons, From/To boxes and left-aligned numbers.

- [ ] **Step 4: Implement — `LegDistancesTab.tsx`**

Replace the whole file `artifacts/studio/src/components/workspace/tabs/LegDistancesTab.tsx` with:

```bash
mkdir -p artifacts/studio/src/components/workspace/tabs && cat > artifacts/studio/src/components/workspace/tabs/LegDistancesTab.tsx <<'SCU_EOF'
import { useRef, useState } from "react";
import { AlertTriangle, X } from "lucide-react";
import type { Scenario } from "@workspace/api-client-react";
import type { CanonicalUnit } from "@workspace/units";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { DataTable } from "@/components/data-table/DataTable";
import type { ColumnDef } from "@/components/data-table/types";
import { useEntityFileMenus } from "@/components/data-table/useEntityFileMenus";
import { EntityIdCell } from "@/components/tables/EntityIdCell";
import { useDisplayUnit } from "@/contexts/UnitContext";
import { useDistanceDraft } from "@/hooks/useDistanceDraft";

export interface LegDistanceOverride {
  fromId: string;
  toId: string;
  distance: number;
}

type Leg = "mine_to_refinery" | "refinery_to_customer" | "unknown";

interface LegDistancesTabProps {
  /** The scenario's CURRENT distanceOverrides array (localInputs draft) —
   * same field name/shape as p-median-us's DistancesTab (a deliberate B6.2
   * stage 1 naming choice — this model's own vocabulary is unambiguously
   * "distance", not transport-coal's "cost"), but covering BOTH legs (mine
   * -> refinery and refinery -> customer) in one flat array. There's no
   * fixed baseline to enumerate (B4.3's same reasoning): this grid shows
   * exactly what the student has explicitly set. */
  distanceOverrides: LegDistanceOverride[];
  /** The last-SAVED distanceOverrides array (savedInputsRef.current, read at
   * the Workspace.tsx call site) — diffed against `distanceOverrides` purely
   * to drive the changed-row highlight. Never written to. */
  savedDistanceOverrides: LegDistanceOverride[];
  /** Known mine/refinery/customer ids (base dataset + any scenario-local
   * addedRefineries/addedCustomers — no addedMines, the mine is fixed) —
   * used for a cheap client-side existence check AND to derive each row's
   * leg-type badge. B6.2 stage 3's server-side precheck remains the
   * authoritative check the Solve flow actually gates on. */
  mineIds: string[];
  refineryIds: string[];
  customerIds: string[];
  onChange: (next: LegDistanceOverride[]) => void;
  /** Undefined while the scenario hasn't resolved yet — Upload/Download stay disabled until it has. */
  scenarioId?: number;
  /** Fired after a successful import apply, with the updated scenario — the caller (Workspace.tsx) refreshes its inputs draft from it. */
  onImportApplied?: (scenario: Scenario) => void;
  /** Phase 3.2, Task 4 — when set, scroll/highlight the row(s) referencing this entity id (the post-Save precheck toast's "jump to it" action). Cleared by the consumer after use — this component doesn't clear it itself. */
  focusEntityId?: string | null;
  /** Followup — scenario-local added entities' `id -> displayCode` map (Workspace.tsx builds this from addedRefineries/addedCustomers — no addedMines, the mine is fixed). From/To cells look up through this for DISPLAY ONLY — the underlying stored fromId/toId (the uuid) stays the join key everywhere else (existence checks, leg resolution, edits, removal). Base dataset ids have no entry here and fall back to showing the raw id, unchanged. */
  displayCodeById?: Record<string, string>;
  /** T11 (workspace-fixups-2, item 2/Codex P1) — canonical id -> {city,
   * state, displayId} (base dataset ∪ scenario-local added entities), built
   * by Workspace.tsx's `buildEntityIdentityById(modelId, dataset,
   * localInputs)` (the LIVE draft — this is an INPUT tab). This table was
   * previously BARE-ID ONLY (no location source at all) — user-defined rows
   * can exceed 10, so it upgrades to the stacked City/State + mono
   * display-id cell (matching Open WHs) once the unfiltered row count
   * exceeds 10 AND this map is present; unset (every pre-INT caller) is
   * byte-unchanged. */
  identityById?: Record<string, { city: string; state: string; displayId: string }>;
  /** chen-bands-units, Task 12 — the active model's canonical distance unit
   * ("km" | "mi"), sourced from the manifest. `null`/undefined while it
   * hasn't resolved yet — there is NO fallback: values/labels stay gated (no
   * number, no unit suffix, disabled input) until this is authoritative
   * (Part D, "No fallback unit"). Wired by Workspace.tsx (Task 14). */
  canonicalUnit?: CanonicalUnit | null;
  /** SCU-2.P4.4 (D2) — browsing result history: value cells, remove buttons
   * and the add-row trigger are disabled. */
  readOnly?: boolean;
}

function pairKey(fromId: string, toId: string): string {
  return `${fromId}|${toId}`;
}

// chen-bands-units, Task 12 — one row's Distance cell, a dedicated child
// component for the same Rules-of-Hooks reason as DistancesTab's own
// `DistanceOverrideCell` (`useDistanceDraft` must be called unconditionally
// once per row-component-instance, not inline inside the parent's `.map()`,
// whose row count changes across filter/pagination/add/remove renders).
// Unlike DistancesTab's Override cell, every row here already has a real
// value (this tab has no "blank until an override exists" state — an
// existing override IS the row), so there's no blank-baseline special case,
// and — matching the pre-existing `updateDistance`'s own behavior — an
// invalid draft is simply never committed, with no separate error UI.
function LegDistanceValueCell({
  canonicalUnit,
  currentValue,
  resetKey,
  onCommitValid,
  inputTestId,
  readOnly,
}: {
  canonicalUnit: CanonicalUnit | null;
  currentValue: number;
  resetKey: unknown;
  onCommitValid: (canonicalValue: number) => void;
  inputTestId: string;
  readOnly: boolean;
}) {
  const draft = useDistanceDraft({
    canonicalUnit,
    value: currentValue,
    resetKey,
    presentation: "grouped",
    onCommit: v => {
      if (Number.isFinite(v) && v > 0) onCommitValid(v);
    },
  });
  return (
    <Input
      type="text"
      inputMode="decimal"
      min={0}
      value={draft.text}
      disabled={readOnly || draft.disabled}
      title={readOnly ? READ_ONLY_TITLE : undefined}
      onChange={e => draft.onChange(e.target.value)}
      onFocus={draft.onFocus}
      onBlur={draft.commit}
      onKeyDown={e => {
        if (e.key === "Enter") draft.commit();
        else if (e.key === "Escape") draft.discard();
      }}
      className="h-7 text-xs w-full min-w-24 font-mono"
      data-testid={inputTestId}
    />
  );
}

const READ_ONLY_TITLE = "Read-only while browsing result history.";

// B6.2 stage 4 — two-echelon-gold-au's "Leg distances" grid tab, the
// three-id-space analogue of B5.1's DistancesTab.tsx / Task 30's
// LaneCostsTab.tsx (long-format {fromId, toId, distance} grid, from/to
// filters, changed-row highlight, add-row, Upload/Download wired to the new
// legDistances backend entity). Own component, not a fork of either sibling
// tab — this model's rows span TWO structurally different legs sharing one
// flat array (verified directly against solve_two_echelon/merge_inputs.py's
// build_merged_two_echelon_dataset, not a string-prefix convention), so
// every row needs a visual cue for WHICH leg it represents — neither sibling
// tab's single from/to role pairing has anything to adapt for that.
export function LegDistancesTab({
  distanceOverrides,
  savedDistanceOverrides,
  mineIds,
  refineryIds,
  customerIds,
  onChange,
  scenarioId,
  onImportApplied,
  focusEntityId,
  displayCodeById,
  identityById,
  canonicalUnit = null,
  readOnly = false,
}: LegDistancesTabProps) {
  const files = useEntityFileMenus({
    entity: "legDistances",
    testIdEntity: "legdistances",
    modelId: "two-echelon-gold-au",
    scenarioId,
    onImportApplied,
  });
  const [addingRow, setAddingRow] = useState(false);
  const [newFrom, setNewFrom] = useState("");
  const [newTo, setNewTo] = useState("");
  const [addError, setAddError] = useState<string | null>(null);

  const { effectiveUnit, toDisplay } = useDisplayUnit();
  const unit = canonicalUnit == null ? null : effectiveUnit(canonicalUnit);
  const unitSuffix = (label: string) => (unit ? `${label} (${unit})` : label);

  // The add-row Distance field — see DistancesTab's identical pattern/comment.
  const newDistanceCanonicalRef = useRef<number | null>(null);
  const newDistanceDraft = useDistanceDraft({
    canonicalUnit,
    value: 0,
    resetKey: scenarioId,
    onCommit: v => {
      newDistanceCanonicalRef.current = v;
    },
  });
  const newDistanceText = newDistanceDraft.isDirty ? newDistanceDraft.text : "";

  const mineIdSet = new Set(mineIds);
  const refineryIdSet = new Set(refineryIds);
  const customerIdSet = new Set(customerIds);
  const savedByKey = new Map(savedDistanceOverrides.map(o => [pairKey(o.fromId, o.toId), o.distance]));

  // Leg resolved purely by id-space membership — mirrors merge_inputs.py's
  // build_merged_two_echelon_dataset exactly.
  function legFor(fromId: string, toId: string): Leg {
    if (mineIdSet.has(fromId) && refineryIdSet.has(toId)) return "mine_to_refinery";
    if (refineryIdSet.has(fromId) && customerIdSet.has(toId)) return "refinery_to_customer";
    return "unknown";
  }

  // T11 (workspace-fixups-2, item 2) — `identityById` upgrade above 10 rows (unchanged).
  function resolvedLocation(id: string): { city: string; state: string } | undefined {
    if (identityById && distanceOverrides.length > 10) {
      const entry = identityById[id];
      if (entry && (entry.city || entry.state)) return { city: entry.city, state: entry.state };
    }
    return undefined;
  }
  function resolvedDisplayId(id: string): string {
    return identityById?.[id]?.displayId ?? displayCodeById?.[id] ?? id;
  }

  const LEG_LABEL: Record<Leg, string> = {
    mine_to_refinery: "Mine → Refinery",
    refinery_to_customer: "Refinery → Customer",
    unknown: "Unrecognized pair",
  };

  function isChanged(o: LegDistanceOverride): boolean {
    const saved = savedByKey.get(pairKey(o.fromId, o.toId));
    return saved === undefined || saved !== o.distance;
  }

  function commitDistance(fromId: string, toId: string, canonicalValue: number) {
    onChange(distanceOverrides.map(o => (o.fromId === fromId && o.toId === toId ? { ...o, distance: canonicalValue } : o)));
  }

  function removeRow(fromId: string, toId: string) {
    onChange(distanceOverrides.filter(o => !(o.fromId === fromId && o.toId === toId)));
  }

  function handleAddRow() {
    const fromId = newFrom.trim();
    const toId = newTo.trim();
    newDistanceDraft.commit();
    const distance = newDistanceCanonicalRef.current;

    if (!fromId || !toId) {
      setAddError("From ID and To ID are both required.");
      return;
    }
    if (distance == null || !Number.isFinite(distance) || distance <= 0) {
      setAddError("Distance must be a positive number.");
      return;
    }
    if (distanceOverrides.some(o => o.fromId === fromId && o.toId === toId)) {
      setAddError("A distance override for this pair already exists — edit it in the table instead.");
      return;
    }
    if (legFor(fromId, toId) === "unknown") {
      setAddError("This pair doesn't resolve as a mine→refinery leg or a refinery→customer leg — check the IDs.");
      return;
    }

    setAddError(null);
    onChange([...distanceOverrides, { fromId, toId, distance }]);
    setNewFrom("");
    setNewTo("");
    newDistanceDraft.discard();
    newDistanceCanonicalRef.current = null;
    setAddingRow(false);
  }

  function cancelAddRow() {
    setAddingRow(false);
    setNewFrom("");
    setNewTo("");
    newDistanceDraft.discard();
    newDistanceCanonicalRef.current = null;
    setAddError(null);
  }

  // Rebuilt every render: cells close over live props (see DistancesTab).
  const columns: ColumnDef<LegDistanceOverride>[] = [
    {
      id: "leg",
      header: "Leg",
      kind: "enum",
      value: o => LEG_LABEL[legFor(o.fromId, o.toId)],
      cell: o => {
        const leg = legFor(o.fromId, o.toId);
        return (
          <Badge variant={leg === "unknown" ? "destructive" : "secondary"} data-testid={`badge-leg-${o.fromId}-${o.toId}`}>
            {leg === "unknown" && <AlertTriangle className="w-3 h-3 mr-1" />}
            {LEG_LABEL[leg]}
          </Badge>
        );
      },
    },
    {
      id: "from",
      header: "From",
      kind: "text",
      filter: "text",
      value: o => o.fromId,
      cellClassName: "text-xs",
      cell: o => (
        <EntityIdCell entityId={o.fromId} displayId={resolvedDisplayId(o.fromId)} location={resolvedLocation(o.fromId)} />
      ),
    },
    {
      id: "to",
      header: "To",
      kind: "text",
      filter: "text",
      value: o => o.toId,
      cellClassName: "text-xs",
      cell: o => <EntityIdCell entityId={o.toId} displayId={resolvedDisplayId(o.toId)} location={resolvedLocation(o.toId)} />,
    },
    {
      id: "distance",
      header: unitSuffix("Distance"),
      filterLabel: "Distance",
      kind: "number",
      value: o => (canonicalUnit == null ? null : toDisplay(o.distance, canonicalUnit)),
      cell: o => (
        <div className="flex items-center justify-center gap-1.5">
          <LegDistanceValueCell
            canonicalUnit={canonicalUnit}
            currentValue={o.distance}
            resetKey={scenarioId}
            onCommitValid={v => commitDistance(o.fromId, o.toId, v)}
            inputTestId={`input-legdistance-${o.fromId}-${o.toId}`}
            readOnly={readOnly}
          />
          {isChanged(o) && (
            <span
              className="text-[10px] text-amber-700 bg-amber-100 border border-amber-300 rounded px-1"
              data-testid={`badge-legdistance-changed-${o.fromId}-${o.toId}`}
            >
              Changed
            </span>
          )}
        </div>
      ),
    },
    {
      id: "remove",
      header: "",
      kind: "text",
      filter: false,
      value: () => null,
      cell: o => (
        <button
          type="button"
          aria-label={`Remove leg distance override ${o.fromId} → ${o.toId}`}
          onClick={() => removeRow(o.fromId, o.toId)}
          disabled={readOnly}
          title={readOnly ? READ_ONLY_TITLE : undefined}
          data-testid={`button-remove-legdistance-${o.fromId}-${o.toId}`}
          className="text-muted-foreground hover:text-destructive disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      ),
    },
  ];

  const addRowUi = addingRow ? (
    <div className="flex items-start gap-1.5 mt-2" data-testid="add-legdistance-row-form">
      <Input
        placeholder="From ID (mine or refinery)"
        value={newFrom}
        onChange={e => setNewFrom(e.target.value)}
        className="h-7 text-xs w-44"
        data-testid="input-new-legdistance-from"
      />
      <Input
        placeholder="To ID (refinery or customer)"
        value={newTo}
        onChange={e => setNewTo(e.target.value)}
        className="h-7 text-xs w-44"
        data-testid="input-new-legdistance-to"
      />
      <Input
        type="text"
        inputMode="decimal"
        placeholder={unitSuffix("Distance")}
        value={newDistanceText}
        disabled={newDistanceDraft.disabled}
        onChange={e => newDistanceDraft.onChange(e.target.value)}
        onBlur={newDistanceDraft.commit}
        onKeyDown={e => {
          if (e.key === "Enter") newDistanceDraft.commit();
          else if (e.key === "Escape") newDistanceDraft.discard();
        }}
        className="h-7 text-xs w-24 font-mono"
        data-testid="input-new-legdistance-value"
      />
      <Button size="sm" className="h-7 px-2 text-xs" onClick={handleAddRow} data-testid="button-add-legdistance-confirm">
        Add
      </Button>
      <Button
        size="sm"
        variant="ghost"
        className="h-7 px-2 text-xs"
        onClick={cancelAddRow}
        data-testid="button-add-legdistance-cancel"
      >
        Cancel
      </Button>
    </div>
  ) : (
    <Button
      size="sm"
      variant="outline"
      className="h-7 px-2 text-xs mt-2"
      onClick={() => setAddingRow(true)}
      disabled={readOnly}
      title={readOnly ? READ_ONLY_TITLE : undefined}
      data-testid="button-add-legdistance-row"
    >
      + Add row
    </Button>
  );

  return (
    <div data-testid="legdistances-tab">
      <p className="text-xs text-muted-foreground mb-2">
        One flat list covers both legs — each row is auto-labeled Mine → Refinery or Refinery → Customer based on which IDs it
        references.
      </p>
      <DataTable<LegDistanceOverride>
        rows={distanceOverrides}
        rowKey={o => pairKey(o.fromId, o.toId)}
        columns={columns}
        ctx={{ readOnly, demandEditable: false, isChanged }}
        rowClassName={(o, ctx) => (ctx.isChanged(o) ? "bg-amber-50" : undefined)}
        testIds={{
          toolbar: "legdistances-tab-toolbar",
          row: o => `row-legdistance-${o.fromId}-${o.toId}`,
          pagerPrev: "button-legdistances-prev",
          pagerNext: "button-legdistances-next",
          pageIndicator: "legdistances-page-indicator",
          empty: "legdistances-tab-empty",
        }}
        toolbar={{ upload: files.upload, download: files.download }}
        scrollClassName="max-h-[55vh] overflow-y-auto"
        emptyState={
          <p className="text-sm text-muted-foreground">
            No leg distance overrides yet — add one below, or upload a CSV/JSON file.
          </p>
        }
        // The precheck toast's "jump to it" (was a DOM scroll only): now also
        // clears filters and pages, like Distances (B2.2).
        focus={
          focusEntityId ? { token: focusEntityId, matches: o => o.fromId === focusEntityId || o.toId === focusEntityId } : null
        }
      />
      {addRowUi}
      {addError && (
        <p className="text-[11px] text-destructive mt-1" data-testid="text-add-legdistance-error">
          {addError}
        </p>
      )}
      {files.dialog}
    </div>
  );
}
SCU_EOF
```

- [ ] **Step 5: Wire Workspace, flip the D2 guard, rewrite the by-design test breaks**

Adds `readOnly={isBrowsingHistoryNow}` to the `<LegDistancesTab` mount, flips the guard, rewrites `LegDistancesTab.test.tsx` by design (filter fixtures padded to 11 rows; menus):

```bash
python3 - <<'PY'
import pathlib
EDITS = [
    ('artifacts/studio/src/__tests__/LegDistancesTab.test.tsx',
     '''import { makeExportProviderValue } from "@/__tests__/helpers/renderWithExportProvider";
import { ExportProvider } from "@/contexts/ExportContext";

// chen-bands-units, Task 12 — every render now needs a UnitProvider ancestor''',
     '''import { makeExportProviderValue } from "@/__tests__/helpers/renderWithExportProvider";
import { ExportProvider } from "@/contexts/ExportContext";
import { chooseInputDownload, chooseUpload, filterText } from "@/__tests__/helpers/inputTable";

// chen-bands-units, Task 12 — every render now needs a UnitProvider ancestor'''),
    ('artifacts/studio/src/__tests__/LegDistancesTab.test.tsx',
     '''});

describe("LegDistancesTab — from/to filters", () => {
  it("filters visible rows by the from-id filter text", () => {
    render(
      <LegDistancesTab
        distanceOverrides={overrides}
        savedDistanceOverrides={overrides}
        mineIds={mineIds}
        refineryIds={refineryIds}''',
     '''});

// SCU-2.P4.4 (B2.2) — From/To are FilterMenu text controls, shown above 10
// rows: pad the three-row fixture with eight more mine→refinery rows.
const elevenOverrides = [
  ...overrides,
  ...Array.from({ length: 8 }, (_, i) => ({ fromId: "kalgoorlie", toId: `daggar-hills-${i}`, distance: 300 + i })),
];

describe("LegDistancesTab — from/to filters", () => {
  it("filters visible rows by the from-id filter text", () => {
    render(
      <LegDistancesTab
        distanceOverrides={elevenOverrides}
        savedDistanceOverrides={elevenOverrides}
        mineIds={mineIds}
        refineryIds={refineryIds}'''),
    ('artifacts/studio/src/__tests__/LegDistancesTab.test.tsx',
     '''      />,
    );
    fireEvent.change(screen.getByTestId("input-filter-from"), { target: { value: "cunnamulla" } });
    expect(screen.queryByTestId("row-legdistance-kalgoorlie-daggar-hills")).not.toBeInTheDocument();
    expect(screen.getByTestId("row-legdistance-cunnamulla-sydney")).toBeInTheDocument();''',
     '''      />,
    );
    filterText("from", "cunnamulla");
    expect(screen.queryByTestId("row-legdistance-kalgoorlie-daggar-hills")).not.toBeInTheDocument();
    expect(screen.getByTestId("row-legdistance-cunnamulla-sydney")).toBeInTheDocument();'''),
    ('artifacts/studio/src/__tests__/LegDistancesTab.test.tsx',
     '''
  it("filters visible rows by the to-id filter text", () => {
    render(
      <LegDistancesTab
        distanceOverrides={overrides}
        savedDistanceOverrides={overrides}
        mineIds={mineIds}
        refineryIds={refineryIds}
        customerIds={customerIds}
        onChange={vi.fn()}''',
     '''
  it("filters visible rows by the to-id filter text", () => {
    render(
      <LegDistancesTab
        distanceOverrides={elevenOverrides}
        savedDistanceOverrides={elevenOverrides}
        mineIds={mineIds}
        refineryIds={refineryIds}
        customerIds={customerIds}
        onChange={vi.fn()}'''),
    ('artifacts/studio/src/__tests__/LegDistancesTab.test.tsx',
     '''      />,
    );
    fireEvent.change(screen.getByTestId("input-filter-to"), { target: { value: "melbourne" } });
    expect(screen.queryByTestId("row-legdistance-kalgoorlie-daggar-hills")).not.toBeInTheDocument();
    expect(screen.getByTestId("row-legdistance-daggar-hills-melbourne")).toBeInTheDocument();''',
     '''      />,
    );
    filterText("to", "melbourne");
    expect(screen.queryByTestId("row-legdistance-kalgoorlie-daggar-hills")).not.toBeInTheDocument();
    expect(screen.getByTestId("row-legdistance-daggar-hills-melbourne")).toBeInTheDocument();'''),
    ('artifacts/studio/src/__tests__/LegDistancesTab.test.tsx',
     '''      { scenarioId: null },
    );
    expect(screen.getByTestId("button-export-legdistances-csv")).toBeDisabled();
    expect(screen.getByTestId("button-export-legdistances-json")).toBeDisabled();
    expect(screen.getByTestId("button-import-legdistances")).toBeDisabled();
  });''',
     '''      { scenarioId: null },
    );
    // SCU-2.P4 (B2.3/B2.4) — one Download ▾ trigger now carries the disabled state.
    expect(screen.getByTestId("button-download-legdistances")).toBeDisabled();
    expect(screen.getByTestId("button-import-legdistances")).toBeDisabled();
  });'''),
    ('artifacts/studio/src/__tests__/LegDistancesTab.test.tsx',
     '''    );

    await userEvent.click(screen.getByTestId("button-export-legdistances-csv"));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());''',
     '''    );

    chooseInputDownload("legdistances", "csv");

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());'''),
    ('artifacts/studio/src/__tests__/LegDistancesTab.test.tsx',
     '''
    expect(screen.queryByText("Import legDistances")).not.toBeInTheDocument();
    await userEvent.click(screen.getByTestId("button-import-legdistances"));
    expect(screen.getByText("Import legDistances")).toBeInTheDocument();
    expect(screen.getByTestId("input-import-file-legDistances")).toBeInTheDocument();''',
     '''
    expect(screen.queryByText("Import legDistances")).not.toBeInTheDocument();
    chooseUpload("legdistances", "csv");
    expect(screen.getByText("Import legDistances")).toBeInTheDocument();
    expect(screen.getByTestId("input-import-file-legDistances")).toBeInTheDocument();'''),
    ('artifacts/studio/src/__tests__/LegDistancesTab.test.tsx',
     '    );\n\n    await userEvent.click(screen.getByTestId("button-import-legdistances"));\n    const file = new File(["template_version,from_id,to_id,distance\\n1,kalgoorlie,daggar-hills,293.7"], "legDistances.csv", { type: "text/csv" });\n    await userEvent.upload(screen.getByTestId("input-import-file-legDistances"), file);',
     '    );\n\n    chooseUpload("legdistances", "csv");\n    const file = new File(["template_version,from_id,to_id,distance\\n1,kalgoorlie,daggar-hills,293.7"], "legDistances.csv", { type: "text/csv" });\n    await userEvent.upload(screen.getByTestId("input-import-file-legDistances"), file);'),
    ('artifacts/studio/src/pages/Workspace.tsx',
     '''        <LegDistancesTab
''',
     '''        <LegDistancesTab
          readOnly={isBrowsingHistoryNow}
'''),
    ('artifacts/studio/src/__tests__/historyReadOnlyTabs.test.ts',
     '''  LegDistancesTab: "pending", // SCU-2.P4.4''',
     '''  LegDistancesTab: "readOnly", // SCU-2.P4.4'''),
]
for path, old, new in EDITS:
    f = pathlib.Path(path)
    s = f.read_text()
    n = s.count(old)
    if n != 1:
        raise SystemExit(f'STOP: {path}: anchor found {n} times (expected 1): {old[:80]!r}')
    f.write_text(s.replace(old, new, 1))
print(f'applied {len(EDITS)} edits')
PY
```

- [ ] **Step 6: Run the task's tests**

Run: `pnpm --filter studio exec vitest run src/__tests__/LegDistancesTab.dataTable.test.tsx src/__tests__/LegDistancesTab.test.tsx src/__tests__/historyReadOnlyTabs.test.ts`
Expected: PASS — 50 tests in 3 files (measured at plan time). Then `pnpm --filter studio typecheck` → exit 0.

- [ ] **Step 7: e2e sweep, rewrites and local run**

Sweep (matrix §3 prefixes for this instance; `labs.spec.ts` excluded):
```bash
grep -rn -E 'legdistances-tab|row-legdistance-|badge-leg-|input-legdistance-|button-export-legdistances|button-import-legdistances' artifacts/studio/e2e --include='*.ts' | grep -v labs.spec.ts
```
No rewrite needed: `bundle2-fastfollow.spec.ts` counts `row-legdistance-*` (> 0 on page 1) and `bundle6.1-legend-distances.spec.ts` (`@flaky`-tagged leg test) seeds one row. `button-export/import-legdistances` hits belong to JADE Distances (P4.5). `npx playwright test <file>` runs `@flaky` tests too.

Then `pnpm --filter studio typecheck:e2e` (exit 0) and, with both local servers up (Global Constraints), run
```bash
cd artifacts/studio && E2E_BASE_URL=http://localhost:5179 npx playwright test e2e/bundle2-fastfollow.spec.ts e2e/bundle6.1-legend-distances.spec.ts
```
Expected: every test passes (a failure → flake registry by test name, two isolated re-runs, before calling it a regression). Record per-spec pass/fail in the changelog entry.

- [ ] **Step 8: Gate**

Run each separately (Global Constraints):
1. `cnt=$(ps aux | grep "[v]itest" | grep -v "zsh -c" | wc -l | tr -d ' '); [ "$cnt" = "0" ]`
2. `pnpm run typecheck`
3. `pnpm --filter studio typecheck:e2e`
4. `DATABASE_URL="postgresql://shubhamkr@localhost:5432/nos_dev" pnpm --filter api-server test`
5. `pnpm --filter studio test`
6. `(cd artifacts/api-server/src/solver && python3 -m pytest tests/ -x)`
7. `pnpm --filter @workspace/import-schema test`

Expected: every command exits 0. Then `git diff --stat "$P3_TIP"..HEAD -- artifacts/api-server lib/db lib/api-spec` prints nothing.

- [ ] **Step 9: Changelog**

Append to the bottom of `docs/CHANGELOG-implementation.md`:

```markdown

### SCU-2.P4.4 — Leg Distances on DataTable

- `LegDistancesTab` on DataTable: FilterMenu (from/to/leg/distance), pager > 50 (new), Upload ▾/Download ▾, D2 read-only, focus clears filters + pages.
- Deviations 3, 6, 7, 15, 17.
- Gate: studio <N passed>, api-server <N passed>, pytest <N passed>, import-schema <N passed>. e2e (local, `E2E_BASE_URL` set): <spec: pass/fail per spec>.
```

Replace each `<…>` with the value measured in this run, or the literal `unknown`.

- [ ] **Step 10: Commit**

```bash
git add artifacts/studio/src/__tests__/LegDistancesTab.dataTable.test.tsx
```

```bash
[ "$(git rev-parse --abbrev-ref HEAD)" != "main" ] || exit 1
```

```bash
git commit artifacts/studio/src/__tests__/LegDistancesTab.dataTable.test.tsx artifacts/studio/src/components/workspace/tabs/LegDistancesTab.tsx artifacts/studio/src/__tests__/LegDistancesTab.test.tsx artifacts/studio/src/pages/Workspace.tsx artifacts/studio/src/__tests__/historyReadOnlyTabs.test.ts docs/CHANGELOG-implementation.md -m "[SCU-2.P4.4] move Leg Distances onto DataTable" -m "FilterMenu replaces From/To, pager >50 (new), Upload/Download menus, D2 read-only, focus via DataTable. Deviations 3, 6, 7, 15, 17." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task SCU-2.P4.5: JADE Distances on DataTable + real-browser focus check

**Owner role:** frontend-engineer. **Matrix:** §1 #12, §2b JadeDistances. **Spec:** B2.1–B2.4, D2; P1 hand-off. **Deviations:** 3, 5, 6, 7, 15, 17.

**Files:**
- Create: `artifacts/studio/src/__tests__/JadeDistancesTab.dataTable.test.tsx`
- Modify: `artifacts/studio/src/components/workspace/tabs/JadeDistancesTab.tsx`
- Modify: `artifacts/studio/src/__tests__/JadeDistancesTab.test.tsx`
- Modify: `artifacts/studio/src/pages/Workspace.tsx`
- Modify: `artifacts/studio/src/__tests__/historyReadOnlyTabs.test.ts`
- Modify: `artifacts/studio/e2e/jade-two-echelon.spec.ts`
- Modify: `docs/CHANGELOG-implementation.md` (append `### SCU-2.P4.5`)

**Interfaces:**
- Consumes: as P4.3; `laneCostPerTon`, `minChargeBinds`, `TEXTBOOK_TRANSPORT_COSTS` (unchanged).
- Produces: `JadeDistancesTab` prop `readOnly?: boolean`.

**Behaviour changes (record each in the changelog):**
- FilterMenu keeps from/to ("City, ST code" text) and gains Leg select, Base/Override/$-per-ton ranges, a Min? select.
- Pager only above 50 rows (was always on).
- Upload ▾ / Download ▾; history read-only (D2); numbers centred.

- [ ] **Step 0: Invoke the simplicity skills**

Skill tool: `andrej-karpathy-skills:karpathy-guidelines`, then `ponytail:ponytail`. Record in the report that both ran (hard rule #12).

- [ ] **Step 1: Preconditions**

Run each line alone (worktree root):
```bash
cd /Users/shubhamkr/nos-scu-2.p4.5 && git rev-parse --abbrev-ref HEAD
git merge-base --is-ancestor "$BASE" HEAD || exit 1
git merge-base --is-ancestor "$B1_TIP" HEAD || exit 1
git merge-base --is-ancestor "$P3_TIP" HEAD || exit 1
test -f artifacts/studio/src/components/data-table/DataTable.tsx && test -f artifacts/studio/src/components/data-table/DownloadMenu.tsx && test -d lib/import-schema || exit 1
pnpm install --frozen-lockfile
```
Then confirm the files this task replaces wholesale are still the `46d2f98` text (Global Constraints):
```bash
git diff --quiet 46d2f98 HEAD -- artifacts/studio/src/components/workspace/tabs/JadeDistancesTab.tsx || { echo 'STOP: artifacts/studio/src/components/workspace/tabs/JadeDistancesTab.tsx changed since 46d2f98'; exit 1; }
```

- [ ] **Step 2: Write the failing test**

Create `artifacts/studio/src/__tests__/JadeDistancesTab.dataTable.test.tsx`:

```bash
mkdir -p artifacts/studio/src/__tests__ && cat > artifacts/studio/src/__tests__/JadeDistancesTab.dataTable.test.tsx <<'SCU_EOF'
// SCU-2.P4.5 — JadeDistancesTab on the shared DataTable (spec B2.1–B2.4, D2).

import { useState, type ReactNode } from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AllProviders } from "@/__tests__/helpers/renderWithExportProvider";
import { JadeDistancesTab, type JadeDistanceOverride } from "@/components/workspace/tabs/JadeDistancesTab";

function Providers({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={client}>
      <AllProviders>{children}</AllProviders>
    </QueryClientProvider>
  );
}

const plantIds = ["plant-1", "plant-2"];
const warehouseIds = Array.from({ length: 20 }, (_, i) => `wh-${i + 1}`);
const customerIds = ["cust-1", "cust-2"];
// 40 plant→warehouse rows + 20 warehouse→customer rows = 60 → two pages.
// plant-9 is an unknown plant; the very last row is unsaved (Changed).
const rows: JadeDistanceOverride[] = [
  ...["plant-1", "plant-9"].flatMap(p =>
    warehouseIds.map((w, i) => ({ leg: "plant_to_warehouse" as const, fromId: p, toId: w, distance: 200 + i, estimated: p === "plant-1" && i === 0 })),
  ),
  ...warehouseIds.map((w, i) => ({ leg: "warehouse_to_customer" as const, fromId: w, toId: "cust-1", distance: 50 + i })),
];
const saved = rows.slice(0, 59);

function renderTab(props: Partial<React.ComponentProps<typeof JadeDistancesTab>> = {}) {
  return render(
    <JadeDistancesTab
      distanceOverrides={rows}
      savedDistanceOverrides={saved}
      plantIds={plantIds}
      warehouseIds={warehouseIds}
      customerIds={customerIds}
      onChange={vi.fn()}
      canonicalUnit="mi"
      scenarioId={1}
      {...props}
    />,
    { wrapper: Providers },
  );
}

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

describe("JadeDistancesTab on DataTable (SCU-2.P4.5)", () => {
  it("emits every testid in the matrix map", () => {
    renderTab();
    const k = "plant_to_warehouse-plant-1-wh-1";
    for (const id of [
      "jade-distances-tab",
      "jadedistances-tab-toolbar",
      "button-import-legdistances",
      "button-download-legdistances",
      "button-filter-menu-trigger",
      `row-jadedistance-${k}`,
      `badge-leg-${k}`,
      `input-jadedistance-${k}`,
      `badge-jadedistance-estimated-${k}`,
      `cell-jadedistance-cost-${k}`,
      `button-remove-jadedistance-${k}`,
      "warning-unknown-from-plant_to_warehouse-plant-9-wh-1",
      "button-jadedistances-prev",
      "button-jadedistances-next",
      "jadedistances-page-indicator",
      "button-add-jadedistance-row",
    ]) {
      expect(screen.getByTestId(id)).toBeInTheDocument();
    }
    // the $/ton testid sits on the <td> itself (P1 adapter rule)
    expect(screen.getByTestId(`cell-jadedistance-cost-${k}`).tagName).toBe("TD");
    fireEvent.click(screen.getByTestId("button-jadedistances-next"));
    expect(screen.getByTestId("badge-jadedistance-changed-warehouse_to_customer-wh-20-cust-1")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("button-add-jadedistance-row"));
    expect(screen.getByTestId("select-new-jadedistance-leg")).toBeInTheDocument();
  });

  it("from/to keep their 'City, ST code' text filters; leg is a select", () => {
    renderTab();
    fireEvent.click(screen.getByTestId("button-filter-menu-trigger"));
    expect(screen.getByTestId("input-filter-from")).toBeInTheDocument();
    expect(screen.getByTestId("input-filter-to")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("checkbox-filter-leg-Warehouse → Customer"));
    expect(screen.queryByTestId("row-jadedistance-plant_to_warehouse-plant-1-wh-1")).toBeNull();
    expect(screen.getByTestId("row-jadedistance-warehouse_to_customer-wh-1-cust-1")).toBeInTheDocument();
  });

  it("numbers centred (Base, Override, $/ton)", () => {
    renderTab();
    const headers = within(screen.getByTestId("jade-distances-tab")).getAllByRole("columnheader");
    expect(headers.map(h => h.textContent)).toEqual(["Leg", "From", "To", "Base (mi)", "Override (mi)", "$/ton", "Min?", ""]);
    for (const i of [3, 4, 5]) expect(headers[i]).toHaveClass("text-center");
  });

  it("history read-only (D2)", () => {
    renderTab({ readOnly: true });
    const k = "plant_to_warehouse-plant-1-wh-1";
    expect(screen.getByTestId(`input-jadedistance-${k}`)).toBeDisabled();
    expect(screen.getByTestId(`button-remove-jadedistance-${k}`)).toBeDisabled();
    expect(screen.getByTestId("button-add-jadedistance-row")).toBeDisabled();
  });

  it("amber on the changed row, sky on the estimated row", () => {
    renderTab();
    expect(screen.getByTestId("row-jadedistance-plant_to_warehouse-plant-1-wh-1")).toHaveClass("bg-sky-50");
    fireEvent.click(screen.getByTestId("button-jadedistances-next"));
    expect(screen.getByTestId("row-jadedistance-warehouse_to_customer-wh-20-cust-1")).toHaveClass("bg-amber-50");
  });

  it("focus jump: clears the filter and moves to the target's page", () => {
    const { rerender } = renderTab();
    fireEvent.click(screen.getByTestId("button-filter-menu-trigger"));
    fireEvent.change(screen.getByTestId("input-filter-from"), { target: { value: "plant-1" } });
    rerender(
      <JadeDistancesTab
        distanceOverrides={rows}
        savedDistanceOverrides={saved}
        plantIds={plantIds}
        warehouseIds={warehouseIds}
        customerIds={customerIds}
        onChange={vi.fn()}
        canonicalUnit="mi"
        scenarioId={1}
        focusEntityId="cust-1"
      />,
    );
    expect(screen.getByTestId("input-filter-from")).toHaveValue("");
    // first cust-1 row is index 40 → page 1; the last (index 59) is on page 2
    expect(screen.getByTestId("jadedistances-page-indicator")).toHaveTextContent("Page 1 of 2");
    expect(screen.getByTestId("row-jadedistance-warehouse_to_customer-wh-1-cust-1")).toBeInTheDocument();
  });

  it("edit round-trip through a stateful parent", () => {
    function Parent() {
      const [r, setR] = useState(rows.slice(0, 3));
      return (
        <JadeDistancesTab
          distanceOverrides={r}
          savedDistanceOverrides={rows.slice(0, 3)}
          plantIds={plantIds}
          warehouseIds={warehouseIds}
          customerIds={customerIds}
          onChange={setR}
          canonicalUnit="mi"
        />
      );
    }
    render(<Parent />, { wrapper: Providers });
    const id = "input-jadedistance-plant_to_warehouse-plant-1-wh-2";
    fireEvent.change(screen.getByTestId(id), { target: { value: "333" } });
    fireEvent.blur(screen.getByTestId(id));
    expect(screen.getByTestId(id)).toHaveValue("333");
    expect(screen.getByTestId("badge-jadedistance-changed-plant_to_warehouse-plant-1-wh-2")).toBeInTheDocument();
  });
});
SCU_EOF
```

- [ ] **Step 3: Run it to verify it fails**

Run: `pnpm --filter studio exec vitest run src/__tests__/JadeDistancesTab.dataTable.test.tsx`
Expected: FAIL — `Tests  4 failed | 3 passed (7)` (measured at plan time against the pre-migration tab) — the history test finds enabled controls (and `readOnly` is not yet a prop — a type error under `pnpm --filter studio typecheck`), and the menu/filter/centring assertions find today's single buttons, From/To boxes and left-aligned numbers.

- [ ] **Step 4: Implement — `JadeDistancesTab.tsx`**

Replace the whole file `artifacts/studio/src/components/workspace/tabs/JadeDistancesTab.tsx` with:

```bash
mkdir -p artifacts/studio/src/components/workspace/tabs && cat > artifacts/studio/src/components/workspace/tabs/JadeDistancesTab.tsx <<'SCU_EOF'
import { useMemo, useRef, useState } from "react";
import { AlertTriangle, X } from "lucide-react";
import type { Scenario } from "@workspace/api-client-react";
import { useGetReferenceDistances, getGetReferenceDistancesQueryKey } from "@workspace/api-client-react";
import { roundForFile, type CanonicalUnit } from "@workspace/units";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import { DataTable } from "@/components/data-table/DataTable";
import type { ColumnDef } from "@/components/data-table/types";
import { useEntityFileMenus } from "@/components/data-table/useEntityFileMenus";
import { formatCityState } from "@/lib/formatLocation";
import { EntityIdCell } from "@/components/tables/EntityIdCell";
import { useDisplayUnit } from "@/contexts/UnitContext";
import { useDistanceDraft } from "@/hooks/useDistanceDraft";
import { formatDistanceDisplay, stripGrouping } from "@/lib/formatDistanceDisplay";
import { laneCostPerTon, minChargeBinds, TEXTBOOK_TRANSPORT_COSTS, type TransportCosts } from "@/lib/transportCosts";

// jade-T15 — Chapter 9 JADE's Distances tab: single `distances.json` covering
// BOTH legs (plant->warehouse, warehouse->customer) in one flat array, keyed
// by the TRIPLE (leg, fromId, toId) — not the pair. This is a genuinely
// different shape from both siblings, so it's its own component (matching
// this codebase's established per-model-shape precedent — LegDistancesTab
// for two-echelon-gold-au, DistancesTab for p-median-us) rather than an
// extension of either:
//   - unlike two-echelon-gold-au's LegDistancesTab (leg purely inferred from
//     which id-space fromId/toId belong to, no reference matrix at all),
//     JADE's `distanceOverrideSchema` carries an EXPLICIT, required `leg`
//     field (jadeInputs.ts's own header comment: the id spaces aren't
//     guaranteed to stay mutually exclusive once entities can be added
//     freely across three roles — defense in depth) and the
//     reference-distances endpoint tags every pair with `leg` too
//     (referenceDistances.ts's buildJadeReferenceDistancePairs).
//   - unlike p-median-us's DistancesTab (pair-keyed, one implicit leg), this
//     table's row identity is the triple, so two of its structural
//     invariants (pairKey, uniqueness) are widened to a triple.
// Otherwise mirrors DistancesTab.tsx's merged base+override single table
// exactly: pagination, From/To filters, `displayCode` substitution for
// scenario-local added entities, the 4 override transitions (add/edit/clear/
// clear-saved-stays-Changed), estimated-row chips, load/error states, and
// Upload/Download wired to T7's `legDistances` export/import entity (the
// SAME entity string two-echelon-gold-au's LegDistancesTab already uses —
// the backend reuses one route/service layer for both models' composite-key
// grid, see routes/scenarios.ts's `entityIsJade`/`entityIsTwoEchelon`
// branches).

export type JadeLeg = "plant_to_warehouse" | "warehouse_to_customer";

export interface JadeDistanceOverride {
  leg: JadeLeg;
  fromId: string;
  toId: string;
  distance: number;
  /** T1 (Input Map v2) precedent — true when this row was auto-filled by the
   * backend's haversine normalizer rather than entered or imported by the
   * student. Purely a display flag — editing the distance drops it,
   * treating the edit as a confirmation. */
  estimated?: boolean;
}

interface JadeDistancesTabProps {
  /** The scenario's CURRENT distanceOverrides array (localInputs draft). */
  distanceOverrides: JadeDistanceOverride[];
  /** The last-SAVED distanceOverrides array — diffed against
   * `distanceOverrides` purely to drive the changed-row highlight. Never
   * written to. */
  savedDistanceOverrides: JadeDistanceOverride[];
  /** Known plant ids (base dataset + any scenario-local addedPlants) — used
   * for a cheap client-side existence check on a plant_to_warehouse row's
   * fromId. B2.1-style precheck remains the authoritative check the Solve
   * flow actually gates on; this is a nice-to-have early warning. */
  plantIds: string[];
  /** Known warehouse ids (base dataset + addedWarehouses) — the middle role,
   * adjacent to BOTH legs (toId of plant_to_warehouse, fromId of
   * warehouse_to_customer). */
  warehouseIds: string[];
  /** Known customer ids (base dataset + addedCustomers). */
  customerIds: string[];
  onChange: (next: JadeDistanceOverride[]) => void;
  /** Undefined while the scenario hasn't resolved yet — Upload/Download stay disabled until it has. */
  scenarioId?: number;
  /** Fired after a successful import apply, with the updated scenario. */
  onImportApplied?: (scenario: Scenario) => void;
  /** Phase 3.2, Task 4 pattern — when set, scroll/highlight the row(s)
   * referencing this entity id (the post-Save precheck toast's "jump to it"
   * action). Cleared by the consumer after use. */
  focusEntityId?: string | null;
  /** Scenario-local added entities' `id -> displayCode` map (Workspace.tsx
   * builds this from addedPlants/addedWarehouses/addedCustomers). From/To
   * cells look up through this for DISPLAY ONLY — the underlying stored
   * fromId/toId (the uid) stays the join key everywhere else. Base dataset
   * ids have no entry here and fall back to showing the raw id, unchanged. */
  displayCodeById?: Record<string, string>;
  /** Scenario id -> {city, state} map (base dataset ∪ added entities), built
   * by Workspace.tsx. From/To cells show "City, ST" as the primary label with
   * the id/displayCode as a sub-label. DISPLAY ONLY — the stored fromId/toId
   * uid stays the join key. Ids absent here fall back to id-only display. */
  locationById?: Record<string, { city: string; state: string }>;
  /** The active model's id (always "two-echelon-jade-us" in practice), used
   * to fetch its reference-distance matrix. Optional: absent (or
   * `referenceCapable` false) means the merged table becomes
   * override-rows-only. */
  modelId?: string;
  /** Mirrors `manifest.capabilities.supportsReferenceDistances`. The
   * reference fetch only fires when this is true AND `modelId` is set. */
  referenceCapable?: boolean;
  /** Base-dataset warehouse ids currently INACTIVE in the scenario's live
   * (unsaved) `localInputs` draft. Purely a view filter over the immutable
   * reference matrix — never refetched, just hides rows whose warehouse
   * endpoint is presently inactive (unless the pair carries a current or
   * saved override). Applies to BOTH legs a warehouse participates in. */
  inactiveWarehouseIds?: string[];
  /** Base-dataset customer ids currently EXCLUDED in the scenario's live
   * `localInputs` draft. Same filter semantics, applies only to the
   * warehouse_to_customer leg's toId (plants have no status concept at
   * all — jadeInputs.ts's own header comment). */
  excludedCustomerIds?: string[];
  /** T11 (workspace-fixups-2, item 2) — canonical id -> {city, state,
   * displayId}, built by Workspace.tsx's `buildEntityIdentityById(modelId,
   * dataset, localInputs)` (the LIVE draft — this is an INPUT tab). This
   * table is already-rich (JADE always passes `locationById`), so the
   * compatibility resolver is unconditional (no `>10` gate needed): prefer
   * `identityById`, else the existing `locationById`/`displayCodeById`
   * sources, else the canonical id — leaving this prop unset is
   * byte-unchanged. */
  identityById?: Record<string, { city: string; state: string; displayId: string }>;
  /** chen-bands-units, Task 12 — the active model's canonical distance unit
   * ("km" | "mi"), sourced from the manifest. `null`/undefined while it
   * hasn't resolved yet — there is NO fallback: every value/label below and
   * every editable cell stays gated (no number, no unit suffix, disabled
   * input) until this is authoritative (Part D, "No fallback unit"). Wired
   * by Workspace.tsx (Task 14). */
  canonicalUnit?: CanonicalUnit | null;
  /** ch9-tc — the scenario's EFFECTIVE transportation rates, used only to
   *  DERIVE the $/ton and Min? columns. Never stored per lane and never
   *  editable here — the Transportation Costs tab owns the four values, and
   *  these columns recompute from the same live draft, so they cannot
   *  drift. Defaults to the textbook values for a caller that omits it. */
  transportCosts?: TransportCosts;
  /** SCU-2.P4.5 (D2) — browsing result history: override cells, remove
   * buttons and the add-row trigger are disabled. */
  readOnly?: boolean;
}

const LEG_LABEL: Record<JadeLeg, string> = {
  plant_to_warehouse: "Plant → Warehouse",
  warehouse_to_customer: "Warehouse → Customer",
};

// ch9-tc — the lane's effective distance is the override when set, else the
// base; both are CANONICAL (miles for this model), which is also the rate's
// denominator, so the product is a plain $/ton with no distance unit.
function laneRates(leg: JadeLeg, tc: TransportCosts): { rate: number; min: number } {
  return leg === "plant_to_warehouse"
    ? { rate: tc.icTransCost, min: tc.icMinTrans }
    : { rate: tc.obTransCost, min: tc.obMinTrans };
}

// chen-bands-units, Task 12 — one row's Override cell, the triple-keyed
// analogue of DistancesTab's own `DistanceOverrideCell` (same Rules-of-Hooks
// reason: `useDistanceDraft` must be called unconditionally once per
// row-component-instance, not inline inside the parent's `.map()`).
// `currentValue` is undefined for a base row with no override yet — text is
// forced blank whenever there's no override AND no in-progress draft.
function JadeDistanceOverrideCell({
  canonicalUnit,
  currentValue,
  resetKey,
  onCommitValid,
  inputTestId,
  errorTestId,
  readOnly,
}: {
  canonicalUnit: CanonicalUnit | null;
  currentValue: number | undefined;
  resetKey: unknown;
  onCommitValid: (canonicalValue: number) => void;
  inputTestId: string;
  errorTestId: string;
  readOnly: boolean;
}) {
  const draft = useDistanceDraft({
    canonicalUnit,
    value: currentValue ?? 0,
    resetKey,
    presentation: "grouped",
    onCommit: v => {
      if (Number.isFinite(v) && v > 0) onCommitValid(v);
    },
  });
  const text = !draft.isDirty && currentValue == null ? "" : draft.text;

  // Live, as-you-type domain validation — deliberately independent of the
  // unit-toggle grammar's own notion of "complete" (mirrors DistancesTab's
  // own `DistanceOverrideCell`, this component's non-triple-keyed sibling).
  // ch4-fixes item 4 — see DistancesTab.tsx: the idle text is now grouped
  // ("1,234.57") and `Number()` rejects the separator, so strip first or a
  // valid committed override renders a false validation error.
  const trimmed = stripGrouping(text).trim();
  const numeric = trimmed === "" ? null : Number(trimmed);
  const error =
    trimmed !== "" && (numeric === null || Number.isNaN(numeric) || numeric <= 0) ? "Distance must be a positive number." : null;

  return (
    <div className="flex flex-col gap-0.5">
      {/* text (not type="number") — a native number input's own
          sanitization silently strips a malformed string like "12abc" to
          "" before onChange ever fires. */}
      <Input
        type="text"
        inputMode="decimal"
        value={text}
        disabled={readOnly || draft.disabled}
        title={readOnly ? READ_ONLY_TITLE : undefined}
        onChange={e => draft.onChange(e.target.value)}
        onFocus={draft.onFocus}
        onBlur={draft.commit}
        onKeyDown={e => {
          if (e.key === "Enter") draft.commit();
          else if (e.key === "Escape") draft.discard();
        }}
        aria-invalid={error ? "true" : undefined}
        className={`h-7 text-xs w-full min-w-24 font-mono ${error ? "border-destructive" : ""}`}
        data-testid={inputTestId}
      />
      {error && (
        <p className="text-[11px] text-destructive mt-0.5" data-testid={errorTestId}>
          {error}
        </p>
      )}
    </div>
  );
}

function tripleKey(leg: string, fromId: string, toId: string): string {
  return `${leg}|${fromId}|${toId}`;
}

const READ_ONLY_TITLE = "Read-only while browsing result history.";

// `base === null` means there's genuinely no reference pair for this
// (leg, fromId, toId) — either it's a scenario-local added-entity pair, or
// the model has no reference matrix at all (referenceCapable false).
interface MergedRow {
  leg: JadeLeg;
  fromId: string;
  toId: string;
  base: number | null;
  override?: JadeDistanceOverride;
}

// SCU-2.P4.5 (B2.1/B2.2) — rendered by the shared DataTable: FilterMenu
// (from/to search "City, ST code" as before, plus auto-derived leg/number
// filters) above 10 rows, pager above 50, numbers centred, history read-only.
export function JadeDistancesTab({
  distanceOverrides,
  savedDistanceOverrides,
  plantIds,
  warehouseIds,
  customerIds,
  onChange,
  scenarioId,
  onImportApplied,
  focusEntityId,
  displayCodeById,
  locationById,
  modelId,
  referenceCapable,
  inactiveWarehouseIds,
  excludedCustomerIds,
  identityById,
  canonicalUnit = null,
  transportCosts = TEXTBOOK_TRANSPORT_COSTS,
  readOnly = false,
}: JadeDistancesTabProps) {
  const files = useEntityFileMenus({
    entity: "legDistances",
    testIdEntity: "legdistances",
    modelId,
    scenarioId,
    onImportApplied,
  });
  const [addingRow, setAddingRow] = useState(false);
  const [newLeg, setNewLeg] = useState<JadeLeg>("plant_to_warehouse");
  const [newFrom, setNewFrom] = useState("");
  const [newTo, setNewTo] = useState("");
  const [addError, setAddError] = useState<string | null>(null);

  const { effectiveUnit, toDisplay } = useDisplayUnit();
  const unit = canonicalUnit == null ? null : effectiveUnit(canonicalUnit);
  const unitSuffix = (label: string) => (unit ? `${label} (${unit})` : label);
  const newDistanceCanonicalRef = useRef<number | null>(null);
  const newDistanceDraft = useDistanceDraft({
    canonicalUnit,
    value: 0,
    resetKey: scenarioId,
    onCommit: v => {
      newDistanceCanonicalRef.current = v;
    },
  });
  const newDistanceText = newDistanceDraft.isDirty ? newDistanceDraft.text : "";

  const referenceEnabled = Boolean(referenceCapable && modelId);
  const referenceQuery = useGetReferenceDistances(modelId ?? "", {
    query: {
      enabled: referenceEnabled,
      staleTime: Infinity,
      queryKey: getGetReferenceDistancesQueryKey(modelId ?? ""),
    },
  });

  const plantIdSet = new Set(plantIds);
  const warehouseIdSet = new Set(warehouseIds);
  const customerIdSet = new Set(customerIds);

  const inactiveWarehouseIdSet = useMemo(() => new Set(inactiveWarehouseIds ?? []), [inactiveWarehouseIds]);
  const excludedCustomerIdSet = useMemo(() => new Set(excludedCustomerIds ?? []), [excludedCustomerIds]);
  const referencePairs = referenceQuery.data?.pairs ?? [];

  const baseByKey = useMemo(
    () => new Map(referencePairs.map(p => [tripleKey(p.leg ?? "warehouse_to_customer", p.fromId, p.toId), p])),
    [referencePairs],
  );
  const overrideByKey = useMemo(
    () => new Map(distanceOverrides.map(o => [tripleKey(o.leg, o.fromId, o.toId), o])),
    [distanceOverrides],
  );
  const savedByKey = useMemo(
    () => new Map(savedDistanceOverrides.map(o => [tripleKey(o.leg, o.fromId, o.toId), o])),
    [savedDistanceOverrides],
  );

  const displayValue = (id: string) => displayCodeById?.[id] ?? id;

  function resolvedLocation(id: string): { city: string; state: string } | undefined {
    const entry = identityById?.[id];
    if (entry && (entry.city || entry.state)) return { city: entry.city, state: entry.state };
    return locationById?.[id];
  }
  function resolvedDisplayId(id: string): string {
    return identityById?.[id]?.displayId ?? displayCodeById?.[id] ?? id;
  }

  const locationLabel = (id: string) => {
    const loc = resolvedLocation(id);
    return loc ? formatCityState(loc.city, loc.state) : undefined;
  };
  // The from/to filters search "City, ST code" (unchanged from the pre-DataTable FilterMenu).
  const searchText = (id: string) => `${locationLabel(id) ?? ""} ${displayValue(id)}`;

  function passesStatus(leg: JadeLeg, fromId: string, toId: string): boolean {
    if (leg === "plant_to_warehouse") return !inactiveWarehouseIdSet.has(toId);
    return !inactiveWarehouseIdSet.has(fromId) && !excludedCustomerIdSet.has(toId);
  }

  // Effective rows: base triples (status-filtered unless they carry a current
  // or saved override), then added triples.
  const mergedRowsAll: MergedRow[] = useMemo(() => {
    const base: MergedRow[] = referencePairs
      .filter(p => {
        const leg = p.leg ?? "warehouse_to_customer";
        const k = tripleKey(leg, p.fromId, p.toId);
        const hasOverrideOrSaved = overrideByKey.has(k) || savedByKey.has(k);
        return passesStatus(leg, p.fromId, p.toId) || hasOverrideOrSaved;
      })
      .map(p => {
        const leg = p.leg ?? "warehouse_to_customer";
        return {
          leg,
          fromId: p.fromId,
          toId: p.toId,
          base: p.distance,
          override: overrideByKey.get(tripleKey(leg, p.fromId, p.toId)),
        };
      });
    const added: MergedRow[] = distanceOverrides
      .filter(o => !baseByKey.has(tripleKey(o.leg, o.fromId, o.toId)))
      .map(o => ({ leg: o.leg, fromId: o.fromId, toId: o.toId, base: null, override: o }));
    return [...base, ...added];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [referencePairs, distanceOverrides, baseByKey, overrideByKey, savedByKey, inactiveWarehouseIdSet, excludedCustomerIdSet]);

  function isChangedRow(r: MergedRow): boolean {
    const saved = savedByKey.get(tripleKey(r.leg, r.fromId, r.toId));
    const current = r.override;
    if (!saved && !current) return false;
    if (!saved || !current) return true;
    return saved.distance !== current.distance;
  }

  function commitOverride(r: MergedRow, canonicalValue: number) {
    const key = tripleKey(r.leg, r.fromId, r.toId);
    const nextOverride: JadeDistanceOverride = {
      leg: r.leg,
      fromId: r.fromId,
      toId: r.toId,
      distance: canonicalValue,
      estimated: undefined,
    };
    onChange(
      overrideByKey.has(key)
        ? distanceOverrides.map(o => (tripleKey(o.leg, o.fromId, o.toId) === key ? nextOverride : o))
        : [...distanceOverrides, nextOverride],
    );
  }

  function clearOverride(r: MergedRow) {
    const key = tripleKey(r.leg, r.fromId, r.toId);
    onChange(distanceOverrides.filter(o => tripleKey(o.leg, o.fromId, o.toId) !== key));
  }

  function baseCell(r: MergedRow) {
    if (canonicalUnit == null) {
      return <Spinner className="w-3 h-3" data-testid={`spinner-jadedistance-unit-${r.leg}-${r.fromId}-${r.toId}`} />;
    }
    if (referenceCapable) {
      if (referenceQuery.isLoading) {
        return <Spinner className="w-3 h-3" data-testid={`spinner-jadedistance-base-${r.leg}-${r.fromId}-${r.toId}`} />;
      }
      if (referenceQuery.isError) return "unavailable";
    }
    if (r.base == null) return "—";
    return formatDistanceDisplay(toDisplay(r.base, canonicalUnit));
  }

  function fromRoleId(leg: JadeLeg): Set<string> {
    return leg === "plant_to_warehouse" ? plantIdSet : warehouseIdSet;
  }
  function toRoleId(leg: JadeLeg): Set<string> {
    return leg === "plant_to_warehouse" ? warehouseIdSet : customerIdSet;
  }

  // ch9-tc — $/ton from the effective (override ?? base) CANONICAL distance.
  function laneCost(r: MergedRow): { cost: number; binds: boolean } | null {
    const effective = r.override?.distance ?? r.base;
    if (effective == null) return null;
    const { rate, min } = laneRates(r.leg, transportCosts);
    return { cost: laneCostPerTon(effective, rate, min), binds: minChargeBinds(effective, rate, min) };
  }

  const displayNumber = (v: number | null | undefined) =>
    v == null || canonicalUnit == null ? null : toDisplay(v, canonicalUnit);

  // Rebuilt every render: cells close over live props (see DistancesTab).
  const columns: ColumnDef<MergedRow>[] = [
    {
      id: "leg",
      header: "Leg",
      kind: "enum",
      value: r => LEG_LABEL[r.leg],
      cell: r => (
        <Badge variant="secondary" data-testid={`badge-leg-${r.leg}-${r.fromId}-${r.toId}`}>
          {LEG_LABEL[r.leg]}
        </Badge>
      ),
    },
    {
      id: "from",
      header: "From",
      kind: "text",
      filter: "text",
      value: r => searchText(r.fromId),
      cellClassName: "text-xs",
      cell: r => (
        <div className="flex items-center gap-1">
          <EntityIdCell entityId={r.fromId} displayId={resolvedDisplayId(r.fromId)} location={resolvedLocation(r.fromId)} />
          {!fromRoleId(r.leg).has(r.fromId) && (
            <span title="Unknown ID for this leg's From role" data-testid={`warning-unknown-from-${r.leg}-${r.fromId}-${r.toId}`}>
              <AlertTriangle className="w-3 h-3 text-amber-600" />
            </span>
          )}
        </div>
      ),
    },
    {
      id: "to",
      header: "To",
      kind: "text",
      filter: "text",
      value: r => searchText(r.toId),
      cellClassName: "text-xs",
      cell: r => (
        <div className="flex items-center gap-1">
          <EntityIdCell entityId={r.toId} displayId={resolvedDisplayId(r.toId)} location={resolvedLocation(r.toId)} />
          {!toRoleId(r.leg).has(r.toId) && (
            <span title="Unknown ID for this leg's To role" data-testid={`warning-unknown-to-${r.leg}-${r.fromId}-${r.toId}`}>
              <AlertTriangle className="w-3 h-3 text-amber-600" />
            </span>
          )}
        </div>
      ),
    },
    {
      id: "base",
      header: unitSuffix("Base"),
      filterLabel: "Base",
      kind: "number",
      value: r => displayNumber(r.base),
      cellClassName: "font-mono text-xs",
      cell: r => baseCell(r),
    },
    {
      id: "override",
      header: unitSuffix("Override"),
      filterLabel: "Override",
      kind: "number",
      value: r => displayNumber(r.override?.distance),
      cell: r => (
        <div className="flex items-center justify-center gap-1.5">
          <JadeDistanceOverrideCell
            canonicalUnit={canonicalUnit}
            currentValue={r.override?.distance}
            resetKey={`${scenarioId ?? ""}:${r.override ? "1" : "0"}`}
            onCommitValid={v => commitOverride(r, v)}
            inputTestId={`input-jadedistance-${r.leg}-${r.fromId}-${r.toId}`}
            errorTestId={`text-jadedistance-error-${r.leg}-${r.fromId}-${r.toId}`}
            readOnly={readOnly}
          />
          {r.override?.estimated && (
            <span
              className="text-[10px] text-sky-700 bg-sky-100 border border-sky-300 rounded px-1"
              data-testid={`badge-jadedistance-estimated-${r.leg}-${r.fromId}-${r.toId}`}
            >
              Estimated
            </span>
          )}
          {isChangedRow(r) && (
            <span
              className="text-[10px] text-amber-700 bg-amber-100 border border-amber-300 rounded px-1"
              data-testid={`badge-jadedistance-changed-${r.leg}-${r.fromId}-${r.toId}`}
            >
              Changed
            </span>
          )}
        </div>
      ),
    },
    {
      id: "cost",
      header: "$/ton",
      kind: "number",
      value: r => laneCost(r)?.cost ?? null,
      cellClassName: "font-mono text-xs",
      cellTestId: r => `cell-jadedistance-cost-${r.leg}-${r.fromId}-${r.toId}`,
      cell: r => {
        const c = laneCost(r);
        return c == null ? "—" : c.cost.toFixed(2);
      },
    },
    {
      id: "min",
      header: "Min?",
      kind: "enum",
      value: r => (laneCost(r)?.binds ? "min" : null),
      cellClassName: "text-xs",
      cell: r =>
        laneCost(r)?.binds && (
          <span
            className="text-[10px] text-slate-700 bg-slate-100 border border-slate-300 rounded px-1"
            title="The minimum charge, not the rate, is what this lane pays"
            data-testid={`badge-jadedistance-min-${r.leg}-${r.fromId}-${r.toId}`}
          >
            min
          </span>
        ),
    },
    {
      id: "remove",
      header: "",
      kind: "text",
      filter: false,
      value: () => null,
      cell: r =>
        (r.override || r.base == null) && (
          <button
            type="button"
            aria-label={`Remove distance override ${r.fromId} → ${r.toId} (${LEG_LABEL[r.leg]})`}
            onClick={() => clearOverride(r)}
            disabled={readOnly}
            title={readOnly ? READ_ONLY_TITLE : undefined}
            data-testid={`button-remove-jadedistance-${r.leg}-${r.fromId}-${r.toId}`}
            className="text-muted-foreground hover:text-destructive disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        ),
    },
  ];

  function handleAddRow() {
    const fromId = newFrom.trim();
    const toId = newTo.trim();
    newDistanceDraft.commit();
    const distance = newDistanceCanonicalRef.current;

    if (!fromId || !toId) {
      setAddError("From ID and To ID are both required.");
      return;
    }
    if (distance == null || !Number.isFinite(distance) || distance <= 0) {
      setAddError("Distance must be a positive number.");
      return;
    }
    if (distanceOverrides.some(o => o.leg === newLeg && o.fromId === fromId && o.toId === toId)) {
      setAddError("A distance override for this (leg, from, to) triple already exists — edit it in the table instead.");
      return;
    }

    setAddError(null);
    onChange([...distanceOverrides, { leg: newLeg, fromId, toId, distance }]);
    setNewFrom("");
    setNewTo("");
    newDistanceDraft.discard();
    newDistanceCanonicalRef.current = null;
    setAddingRow(false);
  }

  function cancelAddRow() {
    setAddingRow(false);
    setNewLeg("plant_to_warehouse");
    setNewFrom("");
    setNewTo("");
    newDistanceDraft.discard();
    newDistanceCanonicalRef.current = null;
    setAddError(null);
  }

  const addRowUi = addingRow ? (
    <div className="flex items-start gap-1.5 mt-2 flex-wrap" data-testid="add-jadedistance-row-form">
      <select
        value={newLeg}
        onChange={e => setNewLeg(e.target.value as JadeLeg)}
        className="h-7 text-xs border rounded px-1"
        data-testid="select-new-jadedistance-leg"
      >
        <option value="plant_to_warehouse">Plant → Warehouse</option>
        <option value="warehouse_to_customer">Warehouse → Customer</option>
      </select>
      <Input
        placeholder="From ID"
        value={newFrom}
        onChange={e => setNewFrom(e.target.value)}
        className="h-7 text-xs w-36"
        data-testid="input-new-jadedistance-from"
      />
      <Input
        placeholder="To ID"
        value={newTo}
        onChange={e => setNewTo(e.target.value)}
        className="h-7 text-xs w-36"
        data-testid="input-new-jadedistance-to"
      />
      <Input
        type="text"
        inputMode="decimal"
        placeholder={unitSuffix("Distance")}
        value={newDistanceText}
        disabled={newDistanceDraft.disabled}
        onChange={e => newDistanceDraft.onChange(e.target.value)}
        onBlur={newDistanceDraft.commit}
        onKeyDown={e => {
          if (e.key === "Enter") newDistanceDraft.commit();
          else if (e.key === "Escape") newDistanceDraft.discard();
        }}
        className="h-7 text-xs w-24 font-mono"
        data-testid="input-new-jadedistance-value"
      />
      <Button size="sm" className="h-7 px-2 text-xs" onClick={handleAddRow} data-testid="button-add-jadedistance-confirm">
        Add
      </Button>
      <Button
        size="sm"
        variant="ghost"
        className="h-7 px-2 text-xs"
        onClick={cancelAddRow}
        data-testid="button-add-jadedistance-cancel"
      >
        Cancel
      </Button>
    </div>
  ) : (
    <Button
      size="sm"
      variant="outline"
      className="h-7 px-2 text-xs mt-2"
      onClick={() => setAddingRow(true)}
      disabled={readOnly}
      title={readOnly ? READ_ONLY_TITLE : undefined}
      data-testid="button-add-jadedistance-row"
    >
      + Add row
    </Button>
  );

  const table = (
    <DataTable<MergedRow>
      rows={mergedRowsAll}
      rowKey={r => tripleKey(r.leg, r.fromId, r.toId)}
      columns={columns}
      ctx={{ readOnly, demandEditable: false, isChanged: isChangedRow }}
      rowClassName={(r, ctx) => (ctx.isChanged(r) ? "bg-amber-50" : r.override?.estimated ? "bg-sky-50" : undefined)}
      testIds={{
        toolbar: "jadedistances-tab-toolbar",
        row: r => `row-jadedistance-${r.leg}-${r.fromId}-${r.toId}`,
        pagerPrev: "button-jadedistances-prev",
        pagerNext: "button-jadedistances-next",
        pageIndicator: "jadedistances-page-indicator",
        empty: "jade-distances-tab-empty",
      }}
      toolbar={{ upload: files.upload, download: files.download }}
      scrollClassName="max-h-[55vh] overflow-y-auto"
      emptyState={
        <p className="text-sm text-muted-foreground">No distance overrides yet — add one below, or upload a CSV/JSON file.</p>
      }
      // Jump-to-it (today's behaviour): clear filters, page to the first
      // matching row of the unfiltered list, scroll it into view. Row count in
      // the token re-runs a jump requested before the reference matrix loaded.
      focus={
        focusEntityId
          ? {
              token: `${focusEntityId}|${mergedRowsAll.length}`,
              matches: r => r.fromId === focusEntityId || r.toId === focusEntityId,
            }
          : null
      }
    />
  );

  return (
    <div data-testid="jade-distances-tab">
      {referenceCapable && referenceQuery.isError && (
        <p className="text-xs text-destructive mb-2" data-testid="jadedistances-reference-error">
          Failed to load reference distances.
        </p>
      )}
      {referenceCapable && referenceQuery.isLoading && (
        <p className="text-xs text-muted-foreground mb-2" data-testid="jadedistances-reference-loading">
          Loading reference distances…
        </p>
      )}
      {referenceCapable ? <div data-testid="jadedistances-reference-section">{table}</div> : table}
      {addRowUi}
      {addError && (
        <p className="text-[11px] text-destructive mt-1" data-testid="text-add-jadedistance-error">
          {addError}
        </p>
      )}
      {files.dialog}
    </div>
  );
}
SCU_EOF
```

- [ ] **Step 5: Wire Workspace, flip the D2 guard, rewrite the by-design test breaks**

Adds `readOnly={isBrowsingHistoryNow}` to the `<JadeDistancesTab` mount, flips the guard, and moves `JadeDistancesTab.test.tsx`'s export/import clicks onto the menus:

```bash
python3 - <<'PY'
import pathlib
EDITS = [
    ('artifacts/studio/src/__tests__/JadeDistancesTab.test.tsx',
     '''import { makeExportProviderValue } from "@/__tests__/helpers/renderWithExportProvider";
import { ExportProvider } from "@/contexts/ExportContext";

// jade-T15 — Chapter 9 JADE's Distances tab: single `distances.json` covering''',
     '''import { makeExportProviderValue } from "@/__tests__/helpers/renderWithExportProvider";
import { ExportProvider } from "@/contexts/ExportContext";
import { chooseInputDownload, chooseUpload } from "@/__tests__/helpers/inputTable";

// jade-T15 — Chapter 9 JADE's Distances tab: single `distances.json` covering'''),
    ('artifacts/studio/src/__tests__/JadeDistancesTab.test.tsx',
     '''      { scenarioId: null },
    );
    expect(screen.getByTestId("button-export-legdistances-csv")).toBeDisabled();
    expect(screen.getByTestId("button-export-legdistances-json")).toBeDisabled();
    expect(screen.getByTestId("button-import-legdistances")).toBeDisabled();
  });''',
     '''      { scenarioId: null },
    );
    // SCU-2.P4 (B2.3/B2.4) — one Download ▾ trigger now carries the disabled state.
    expect(screen.getByTestId("button-download-legdistances")).toBeDisabled();
    expect(screen.getByTestId("button-import-legdistances")).toBeDisabled();
  });'''),
    ('artifacts/studio/src/__tests__/JadeDistancesTab.test.tsx',
     '''    );

    await userEvent.click(screen.getByTestId("button-export-legdistances-csv"));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());''',
     '''    );

    chooseInputDownload("legdistances", "csv");

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());'''),
    ('artifacts/studio/src/__tests__/JadeDistancesTab.test.tsx',
     '''
    expect(screen.queryByText("Import legDistances")).not.toBeInTheDocument();
    await userEvent.click(screen.getByTestId("button-import-legdistances"));
    expect(screen.getByText("Import legDistances")).toBeInTheDocument();
    expect(screen.getByTestId("input-import-file-legDistances")).toBeInTheDocument();''',
     '''
    expect(screen.queryByText("Import legDistances")).not.toBeInTheDocument();
    chooseUpload("legdistances", "csv");
    expect(screen.getByText("Import legDistances")).toBeInTheDocument();
    expect(screen.getByTestId("input-import-file-legDistances")).toBeInTheDocument();'''),
    ('artifacts/studio/src/__tests__/JadeDistancesTab.test.tsx',
     '    );\n\n    await userEvent.click(screen.getByTestId("button-import-legdistances"));\n    const file = new File(["template_version,from_id,to_id,distance\\n1,plant-1,wh-1,120.5"], "legDistances.csv", {\n      type: "text/csv",',
     '    );\n\n    chooseUpload("legdistances", "csv");\n    const file = new File(["template_version,from_id,to_id,distance\\n1,plant-1,wh-1,120.5"], "legDistances.csv", {\n      type: "text/csv",'),
    ('artifacts/studio/src/pages/Workspace.tsx',
     '''        <JadeDistancesTab
''',
     '''        <JadeDistancesTab
          readOnly={isBrowsingHistoryNow}
'''),
    ('artifacts/studio/src/__tests__/historyReadOnlyTabs.test.ts',
     '''  JadeDistancesTab: "pending", // SCU-2.P4.5''',
     '''  JadeDistancesTab: "readOnly", // SCU-2.P4.5'''),
]
for path, old, new in EDITS:
    f = pathlib.Path(path)
    s = f.read_text()
    n = s.count(old)
    if n != 1:
        raise SystemExit(f'STOP: {path}: anchor found {n} times (expected 1): {old[:80]!r}')
    f.write_text(s.replace(old, new, 1))
print(f'applied {len(EDITS)} edits')
PY
```

- [ ] **Step 6: Run the task's tests**

Run: `pnpm --filter studio exec vitest run src/__tests__/JadeDistancesTab.dataTable.test.tsx src/__tests__/JadeDistancesTab.test.tsx src/__tests__/historyReadOnlyTabs.test.ts`
Expected: PASS — 75 tests in 3 files (measured at plan time). Then `pnpm --filter studio typecheck` → exit 0.

- [ ] **Step 7: e2e sweep, rewrites and local run**

Sweep (matrix §3 prefixes for this instance; `labs.spec.ts` excluded):
```bash
grep -rn -E 'jade-distances-tab|button-filter-menu-trigger|input-filter-to|badge-jadedistance-|cell-jadedistance-cost-|jadedistances-page' artifacts/studio/e2e --include='*.ts' | grep -v labs.spec.ts
```
Unchanged and still valid: both specs already open `button-filter-menu-trigger` before `input-filter-to` (JADE Distances had a FilterMenu), `cell-jadedistance-cost-*` stays on the `<td>`, `badge-jadedistance-*`. New: the P1 hand-off focus-jump block replaces the map-tab Save in `jade-two-echelon.spec.ts` step 6 (save from the Distances tab with a hiding filter, take the toast's jump, assert filter cleared / page ≠ 1 / row `toBeInViewport`).

Apply the rewrites (each anchor is asserted unique; verified against the Bundle 1 tip `e2e/` tree and type-checked at plan time):

```bash
python3 - <<'PY'
import pathlib
EDITS = [
    ('artifacts/studio/e2e/jade-two-echelon.spec.ts',
     '''import { readSolvedAt } from "./helpers/solvedAt";
''',
     '''import { readSolvedAt } from "./helpers/solvedAt";
import { closePopover, fillTableFilter } from "./helpers/inputTable";
'''),
    ('artifacts/studio/e2e/jade-two-echelon.spec.ts',
     '''      // The map's own Layers row carries Save for this mode (saveInLayersRowJade).
      const mapSaveButton = page.locator('[data-testid="input-map-tab"] [data-testid="button-save"]');
      await expect(mapSaveButton).toBeEnabled({ timeout: HEADER_TIMEOUT });
      await mapSaveButton.click({ timeout: HEADER_TIMEOUT });
      await expect(mapSaveButton).toBeDisabled({ timeout: HEADER_TIMEOUT });
''',
     '      // SCU-2.P4.5 — P1 hand-off (Codex finding 6): a real-browser focus-jump\n      // check. Save from the Distances tab with a filter that hides every row,\n      // then take the estimated-distance toast\'s "Distances" jump: the filter\n      // must be cleared, the pager must leave page 1 (the new warehouse\'s\n      // triples follow every base triple) and the target row must be on screen.\n      await page.getByTestId("sidebar-input-distances").click({ timeout: HEADER_TIMEOUT });\n      await expect(page.getByTestId("jade-distances-tab")).toBeVisible({ timeout: HEADER_TIMEOUT });\n      await fillTableFilter(page, "to", "zz-no-such-id");\n      await closePopover(page);\n      await expect(page.locator(\'[data-testid^="row-jadedistance-"]\')).toHaveCount(0);\n      const toolbarSave = page.getByTestId("button-save");\n      await expect(toolbarSave).toBeEnabled({ timeout: HEADER_TIMEOUT });\n      await toolbarSave.click({ timeout: HEADER_TIMEOUT });\n      await expect(toolbarSave).toBeDisabled({ timeout: HEADER_TIMEOUT });\n      const escapedWhCode = newWhDisplayCode.trim().replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&");\n      const estimateToast = page.getByRole("region").locator("li").filter({\n        hasText: new RegExp(`distances? estimated for ${escapedWhCode}`),\n      });\n      await expect(estimateToast).toBeVisible({ timeout: HEADER_TIMEOUT });\n      await estimateToast.getByRole("button", { name: "Distances" }).click({ timeout: HEADER_TIMEOUT });\n      await page.getByTestId("button-filter-menu-trigger").click({ timeout: HEADER_TIMEOUT });\n      await expect(page.getByTestId("input-filter-to")).toHaveValue("");\n      await closePopover(page);\n      await expect(page.getByTestId("jadedistances-page-indicator")).not.toHaveText(/^Page 1 of/, { timeout: HEADER_TIMEOUT });\n      await expect(page.locator(\'tr:has([data-testid^="badge-jadedistance-estimated-"])\').first()).toBeInViewport({\n        timeout: HEADER_TIMEOUT,\n      });\n'),
]
for path, old, new in EDITS:
    f = pathlib.Path(path)
    s = f.read_text()
    n = s.count(old)
    if n != 1:
        raise SystemExit(f'STOP: {path}: anchor found {n} times (expected 1): {old[:80]!r}')
    f.write_text(s.replace(old, new, 1))
print(f'applied {len(EDITS)} edits')
PY
```

Then `pnpm --filter studio typecheck:e2e` (exit 0) and, with both local servers up (Global Constraints), run
```bash
cd artifacts/studio && E2E_BASE_URL=http://localhost:5179 npx playwright test e2e/jade-two-echelon.spec.ts e2e/jade-transport-costs.spec.ts
```
Expected: every test passes (a failure → flake registry by test name, two isolated re-runs, before calling it a regression). Record per-spec pass/fail in the changelog entry.

- [ ] **Step 8: Gate**

Run each separately (Global Constraints):
1. `cnt=$(ps aux | grep "[v]itest" | grep -v "zsh -c" | wc -l | tr -d ' '); [ "$cnt" = "0" ]`
2. `pnpm run typecheck`
3. `pnpm --filter studio typecheck:e2e`
4. `DATABASE_URL="postgresql://shubhamkr@localhost:5432/nos_dev" pnpm --filter api-server test`
5. `pnpm --filter studio test`
6. `(cd artifacts/api-server/src/solver && python3 -m pytest tests/ -x)`
7. `pnpm --filter @workspace/import-schema test`

Expected: every command exits 0. Then `git diff --stat "$P3_TIP"..HEAD -- artifacts/api-server lib/db lib/api-spec` prints nothing.

- [ ] **Step 9: Changelog**

Append to the bottom of `docs/CHANGELOG-implementation.md`:

```markdown

### SCU-2.P4.5 — JADE Distances on DataTable + real-browser focus check

- `JadeDistancesTab` on DataTable: FilterMenu (from/to search text kept; + leg/base/override/$-per-ton/min), pager > 50 only, Upload ▾/Download ▾, D2 read-only, focus token = id + row count.
- Real-browser focus check added to jade-two-echelon step 6.
- Deviations 3, 5, 6, 7, 15, 17.
- Gate: studio <N passed>, api-server <N passed>, pytest <N passed>, import-schema <N passed>. e2e (local, `E2E_BASE_URL` set): <spec: pass/fail per spec>.
```

Replace each `<…>` with the value measured in this run, or the literal `unknown`.

- [ ] **Step 10: Commit**

```bash
git add artifacts/studio/src/__tests__/JadeDistancesTab.dataTable.test.tsx
```

```bash
[ "$(git rev-parse --abbrev-ref HEAD)" != "main" ] || exit 1
```

```bash
git commit artifacts/studio/src/__tests__/JadeDistancesTab.dataTable.test.tsx artifacts/studio/src/components/workspace/tabs/JadeDistancesTab.tsx artifacts/studio/src/__tests__/JadeDistancesTab.test.tsx artifacts/studio/src/pages/Workspace.tsx artifacts/studio/src/__tests__/historyReadOnlyTabs.test.ts artifacts/studio/e2e/jade-two-echelon.spec.ts docs/CHANGELOG-implementation.md -m "[SCU-2.P4.5] move JADE Distances onto DataTable" -m "FilterMenu kept (+ derived columns), pager >50, Upload/Download menus, D2 read-only, focus via DataTable + browser viewport check. Deviations 3, 5, 6, 7, 15, 17." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task SCU-2.P4.6: Lane Costs on DataTable (transport-coal)

**Owner role:** frontend-engineer. **Matrix:** §1 #13, §2b LaneCosts. **Spec:** B2.1–B2.4, D2. **Deviations:** 3, 6, 7, 15, 17.

**Files:**
- Create: `artifacts/studio/src/__tests__/LaneCostsTab.dataTable.test.tsx`
- Modify: `artifacts/studio/src/components/workspace/tabs/LaneCostsTab.tsx`
- Modify: `artifacts/studio/src/__tests__/LaneCostsTab.test.tsx`
- Modify: `artifacts/studio/src/pages/Workspace.tsx`
- Modify: `artifacts/studio/src/__tests__/historyReadOnlyTabs.test.ts`
- Modify: `docs/CHANGELOG-implementation.md` (append `### SCU-2.P4.6`)

**Interfaces:**
- Consumes: as P4.3.
- Produces: `LaneCostsTab` prop `readOnly?: boolean`; new pager ids `button-lanecosts-prev/next`, `lanecosts-page-indicator`.

**Behaviour changes (record each in the changelog):**
- From/To boxes → FilterMenu (+ Cost range).
- Pager above 50 rows (new).
- Focus jump clears filters and pages (was scroll-only).
- Upload ▾ / Download ▾; history read-only (D2); numbers centred.

- [ ] **Step 0: Invoke the simplicity skills**

Skill tool: `andrej-karpathy-skills:karpathy-guidelines`, then `ponytail:ponytail`. Record in the report that both ran (hard rule #12).

- [ ] **Step 1: Preconditions**

Run each line alone (worktree root):
```bash
cd /Users/shubhamkr/nos-scu-2.p4.6 && git rev-parse --abbrev-ref HEAD
git merge-base --is-ancestor "$BASE" HEAD || exit 1
git merge-base --is-ancestor "$B1_TIP" HEAD || exit 1
git merge-base --is-ancestor "$P3_TIP" HEAD || exit 1
test -f artifacts/studio/src/components/data-table/DataTable.tsx && test -f artifacts/studio/src/components/data-table/DownloadMenu.tsx && test -d lib/import-schema || exit 1
pnpm install --frozen-lockfile
```
Then confirm the files this task replaces wholesale are still the `46d2f98` text (Global Constraints):
```bash
git diff --quiet 46d2f98 HEAD -- artifacts/studio/src/components/workspace/tabs/LaneCostsTab.tsx || { echo 'STOP: artifacts/studio/src/components/workspace/tabs/LaneCostsTab.tsx changed since 46d2f98'; exit 1; }
```

- [ ] **Step 2: Write the failing test**

Create `artifacts/studio/src/__tests__/LaneCostsTab.dataTable.test.tsx`:

```bash
mkdir -p artifacts/studio/src/__tests__ && cat > artifacts/studio/src/__tests__/LaneCostsTab.dataTable.test.tsx <<'SCU_EOF'
// SCU-2.P4.6 — LaneCostsTab (transport-coal) on the shared DataTable (B2.1–B2.4, D2).

import { useState, type ReactNode } from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AllProviders } from "@/__tests__/helpers/renderWithExportProvider";
import { LaneCostsTab, type LaneCostOverride } from "@/components/workspace/tabs/LaneCostsTab";

function Providers({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={client}>
      <AllProviders>{children}</AllProviders>
    </QueryClientProvider>
  );
}

const mineIds = ["MN01", "MN02"];
const stationIds = Array.from({ length: 11 }, (_, i) => `ST${String(i + 1).padStart(3, "0")}`);
// 12 rows; MN09 is an unknown mine; the last row is unsaved (Changed).
const rows: LaneCostOverride[] = [
  ...stationIds.map((st, i) => ({ fromId: "MN01", toId: st, cost: 100 + i })),
  { fromId: "MN09", toId: "ST001", cost: 77 },
];
const saved = rows.slice(0, 11);

function renderTab(props: Partial<React.ComponentProps<typeof LaneCostsTab>> = {}) {
  return render(
    <LaneCostsTab
      laneCostOverrides={rows}
      savedLaneCostOverrides={saved}
      mineIds={mineIds}
      stationIds={stationIds}
      onChange={vi.fn()}
      canonicalUnit="mi"
      scenarioId={1}
      {...props}
    />,
    { wrapper: Providers },
  );
}

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

describe("LaneCostsTab on DataTable (SCU-2.P4.6)", () => {
  it("emits every testid in the matrix map", () => {
    renderTab();
    for (const id of [
      "lanecosts-tab",
      "lanecosts-tab-toolbar",
      "button-import-lanecosts",
      "button-download-lanecosts",
      "button-filter-menu-trigger",
      "row-lanecost-MN01-ST001",
      "input-lanecost-MN01-ST001",
      "button-remove-lanecost-MN01-ST001",
      "warning-unknown-from-MN09-ST001",
      "badge-lanecost-changed-MN09-ST001",
      "button-add-lanecost-row",
    ]) {
      expect(screen.getByTestId(id)).toBeInTheDocument();
    }
    fireEvent.click(screen.getByTestId("button-download-lanecosts"));
    expect(screen.getByTestId("button-export-lanecosts-csv")).toBeInTheDocument();
    expect(screen.getByTestId("button-export-lanecosts-json")).toBeInTheDocument();
  });

  it("empty state keeps its testid", () => {
    renderTab({ laneCostOverrides: [], savedLaneCostOverrides: [] });
    expect(screen.getByTestId("lanecosts-tab-empty")).toHaveTextContent("No lane cost overrides yet");
  });

  it("numbers centred; amber only on the changed row", () => {
    renderTab();
    const headers = within(screen.getByTestId("lanecosts-tab")).getAllByRole("columnheader");
    expect(headers.map(h => h.textContent)).toEqual(["From (mine)", "To (station)", "Cost (mi)", ""]);
    expect(headers[2]).toHaveClass("text-center");
    expect(screen.getByTestId("row-lanecost-MN09-ST001")).toHaveClass("bg-amber-50");
    expect(screen.getByTestId("row-lanecost-MN01-ST001")).not.toHaveClass("bg-amber-50");
  });

  it("history read-only (D2)", () => {
    renderTab({ readOnly: true });
    expect(screen.getByTestId("input-lanecost-MN01-ST001")).toBeDisabled();
    expect(screen.getByTestId("button-remove-lanecost-MN01-ST001")).toBeDisabled();
    expect(screen.getByTestId("button-add-lanecost-row")).toBeDisabled();
  });

  it("filter menu replaces the From/To boxes", () => {
    renderTab();
    fireEvent.click(screen.getByTestId("button-filter-menu-trigger"));
    fireEvent.change(screen.getByTestId("input-filter-from"), { target: { value: "MN09" } });
    expect(screen.getByTestId("row-lanecost-MN09-ST001")).toBeInTheDocument();
    expect(screen.queryByTestId("row-lanecost-MN01-ST001")).toBeNull();
  });

  it("edit round-trip through a stateful parent", () => {
    function Parent() {
      const [r, setR] = useState(rows.slice(0, 2));
      return <LaneCostsTab laneCostOverrides={r} savedLaneCostOverrides={rows.slice(0, 2)} mineIds={mineIds} stationIds={stationIds} onChange={setR} canonicalUnit="mi" />;
    }
    render(<Parent />, { wrapper: Providers });
    fireEvent.change(screen.getByTestId("input-lanecost-MN01-ST002"), { target: { value: "999" } });
    fireEvent.blur(screen.getByTestId("input-lanecost-MN01-ST002"));
    expect(screen.getByTestId("input-lanecost-MN01-ST002")).toHaveValue("999");
    expect(screen.getByTestId("badge-lanecost-changed-MN01-ST002")).toBeInTheDocument();
  });
});
SCU_EOF
```

- [ ] **Step 3: Run it to verify it fails**

Run: `pnpm --filter studio exec vitest run src/__tests__/LaneCostsTab.dataTable.test.tsx`
Expected: FAIL — `Tests  4 failed | 2 passed (6)` (measured at plan time against the pre-migration tab) — the history test finds enabled controls (and `readOnly` is not yet a prop — a type error under `pnpm --filter studio typecheck`), and the menu/filter/centring assertions find today's single buttons, From/To boxes and left-aligned numbers.

- [ ] **Step 4: Implement — `LaneCostsTab.tsx`**

Replace the whole file `artifacts/studio/src/components/workspace/tabs/LaneCostsTab.tsx` with:

```bash
mkdir -p artifacts/studio/src/components/workspace/tabs && cat > artifacts/studio/src/components/workspace/tabs/LaneCostsTab.tsx <<'SCU_EOF'
import { useRef, useState } from "react";
import { AlertTriangle, X } from "lucide-react";
import type { Scenario } from "@workspace/api-client-react";
import type { CanonicalUnit } from "@workspace/units";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/data-table/DataTable";
import type { ColumnDef } from "@/components/data-table/types";
import { useEntityFileMenus } from "@/components/data-table/useEntityFileMenus";
import { EntityIdCell } from "@/components/tables/EntityIdCell";
import { useDisplayUnit } from "@/contexts/UnitContext";
import { useDistanceDraft } from "@/hooks/useDistanceDraft";

export interface LaneCostOverride {
  fromId: string;
  toId: string;
  cost: number;
}

interface LaneCostsTabProps {
  /** The scenario's CURRENT laneCostOverrides array (localInputs draft) —
   * unlike Mines/Stations, there's no fixed baseline to enumerate (mirrors
   * DistancesTab's own reasoning, B4.3): this grid shows exactly what the
   * student has explicitly set, not a merged full dataset. */
  laneCostOverrides: LaneCostOverride[];
  /** The last-SAVED laneCostOverrides array (savedInputsRef.current, read at
   * the Workspace.tsx call site) — diffed against `laneCostOverrides` purely
   * to drive the changed-row highlight. Never written to. */
  savedLaneCostOverrides: LaneCostOverride[];
  /** Known mine ids (base dataset + any scenario-local addedMines) — used
   * only for a cheap client-side existence check ("does this fromId look
   * resolvable"). B6.1 stage 3's server-side precheck remains the
   * authoritative check the Solve flow actually gates on; this is a
   * nice-to-have early warning, not a duplicate of that authority. */
  mineIds: string[];
  stationIds: string[];
  onChange: (next: LaneCostOverride[]) => void;
  /** Undefined while the scenario hasn't resolved yet — Upload/Download stay disabled until it has. */
  scenarioId?: number;
  /** Fired after a successful import apply, with the updated scenario — the caller (Workspace.tsx) refreshes its inputs draft from it. */
  onImportApplied?: (scenario: Scenario) => void;
  /** Phase 3.2, Task 4 — when set, scroll/highlight the row(s) referencing this entity id (the post-Save precheck toast's "jump to it" action). Cleared by the consumer after use — this component doesn't clear it itself. */
  focusEntityId?: string | null;
  /** Followup — scenario-local added entities' `id -> displayCode` map (Workspace.tsx builds this from addedMines/addedStations). From/To cells look up through this for DISPLAY ONLY — the underlying stored fromId/toId (the uuid) stays the join key everywhere else. Base dataset ids have no entry here and fall back to showing the raw id, unchanged. */
  displayCodeById?: Record<string, string>;
  /** T11 (workspace-fixups-2, item 2) — canonical id -> {city, state,
   * displayId} (base dataset ∪ scenario-local added entities), built by
   * Workspace.tsx's `buildEntityIdentityById(modelId, dataset, localInputs)`
   * (the LIVE draft — this is an INPUT tab). This table was previously
   * BARE-ID ONLY — upgrades to the stacked City/State + mono display-id cell
   * (matching Open WHs) once the unfiltered row count exceeds 10 AND this
   * map is present; unset (every pre-INT caller) is byte-unchanged. */
  identityById?: Record<string, { city: string; state: string; displayId: string }>;
  /** chen-bands-units, Task 12 — the active model's canonical distance unit.
   * `laneCostOverrides.cost` values ARE distances in miles
   * (`transportLp.ts:18-25`: named `cost` for transport-coal's own chapter
   * vocabulary only — the objective is literally distance × flow) — they
   * convert exactly like every other distance field in this bundle, despite
   * carrying no unit label anywhere in the pre-existing UI and no "mi"/"km"
   * string anywhere in this file for a unit-literal grep to find. `null`/
   * undefined while unresolved — no fallback (Part D). Wired by
   * Workspace.tsx (Task 14). */
  canonicalUnit?: CanonicalUnit | null;
  /** SCU-2.P4.6 (D2) — browsing result history: cost cells, remove buttons
   * and the add-row trigger are disabled. */
  readOnly?: boolean;
}

function pairKey(fromId: string, toId: string): string {
  return `${fromId}|${toId}`;
}

// chen-bands-units, Task 12 — one row's Cost cell. Dedicated child component
// for the same Rules-of-Hooks reason as the sibling tabs' own per-row cells.
// `cost` here is semantically a DISTANCE (see the prop comment above) — it
// routes through the identical `useDistanceDraft` contract as every other
// tab's distance field, not a special-cased "it's just a cost" path.
function LaneCostValueCell({
  canonicalUnit,
  currentValue,
  resetKey,
  onCommitValid,
  inputTestId,
  readOnly,
}: {
  canonicalUnit: CanonicalUnit | null;
  currentValue: number;
  resetKey: unknown;
  onCommitValid: (canonicalValue: number) => void;
  inputTestId: string;
  readOnly: boolean;
}) {
  const draft = useDistanceDraft({
    canonicalUnit,
    value: currentValue,
    resetKey,
    presentation: "grouped",
    onCommit: v => {
      if (Number.isFinite(v) && v > 0) onCommitValid(v);
    },
  });
  return (
    <Input
      type="text"
      inputMode="decimal"
      min={0}
      value={draft.text}
      disabled={readOnly || draft.disabled}
      title={readOnly ? READ_ONLY_TITLE : undefined}
      onChange={e => draft.onChange(e.target.value)}
      onFocus={draft.onFocus}
      onBlur={draft.commit}
      onKeyDown={e => {
        if (e.key === "Enter") draft.commit();
        else if (e.key === "Escape") draft.discard();
      }}
      className="h-7 text-xs w-full min-w-24 font-mono"
      data-testid={inputTestId}
    />
  );
}

const READ_ONLY_TITLE = "Read-only while browsing result history.";

// Task 30 (B6.1 stage 4) — transport-coal's "Lane costs" grid tab, the
// mine/station analogue of B5.1's DistancesTab.tsx (long-format
// {fromId, toId, cost} grid, from/to filters, changed-row highlight, add-row,
// Upload/Download wired to the new laneCosts backend entity) — closely
// mirrors that component's structure, field name (`cost` not `distance`) and
// vocabulary ("mine"/"station") aside, per stage 1-3's own established
// naming decision for this model.
// SCU-2.P4.6 (B2.1/B2.2) — rendered by the shared DataTable (FilterMenu
// replaces the From/To boxes, pager above 50, numbers centred, D2).
export function LaneCostsTab({
  laneCostOverrides,
  savedLaneCostOverrides,
  mineIds,
  stationIds,
  onChange,
  scenarioId,
  onImportApplied,
  focusEntityId,
  displayCodeById,
  identityById,
  canonicalUnit = null,
  readOnly = false,
}: LaneCostsTabProps) {
  const files = useEntityFileMenus({
    entity: "laneCosts",
    testIdEntity: "lanecosts",
    modelId: "transport-coal",
    scenarioId,
    onImportApplied,
  });
  const [addingRow, setAddingRow] = useState(false);
  const [newFrom, setNewFrom] = useState("");
  const [newTo, setNewTo] = useState("");
  const [addError, setAddError] = useState<string | null>(null);

  const { effectiveUnit, toDisplay } = useDisplayUnit();
  const unit = canonicalUnit == null ? null : effectiveUnit(canonicalUnit);
  const unitSuffix = (label: string) => (unit ? `${label} (${unit})` : label);
  const newCostCanonicalRef = useRef<number | null>(null);
  const newCostDraft = useDistanceDraft({
    canonicalUnit,
    value: 0,
    resetKey: scenarioId,
    onCommit: v => {
      newCostCanonicalRef.current = v;
    },
  });
  const newCostText = newCostDraft.isDirty ? newCostDraft.text : "";

  const mineIdSet = new Set(mineIds);
  const stationIdSet = new Set(stationIds);
  const savedByKey = new Map(savedLaneCostOverrides.map(o => [pairKey(o.fromId, o.toId), o.cost]));

  // T11 (workspace-fixups-2, item 2) — `identityById` upgrade above 10 rows (unchanged).
  function resolvedLocation(id: string): { city: string; state: string } | undefined {
    if (identityById && laneCostOverrides.length > 10) {
      const entry = identityById[id];
      if (entry && (entry.city || entry.state)) return { city: entry.city, state: entry.state };
    }
    return undefined;
  }
  function resolvedDisplayId(id: string): string {
    return identityById?.[id]?.displayId ?? displayCodeById?.[id] ?? id;
  }

  function isChanged(o: LaneCostOverride): boolean {
    const saved = savedByKey.get(pairKey(o.fromId, o.toId));
    return saved === undefined || saved !== o.cost;
  }

  function commitCost(fromId: string, toId: string, canonicalValue: number) {
    onChange(laneCostOverrides.map(o => (o.fromId === fromId && o.toId === toId ? { ...o, cost: canonicalValue } : o)));
  }

  function removeRow(fromId: string, toId: string) {
    onChange(laneCostOverrides.filter(o => !(o.fromId === fromId && o.toId === toId)));
  }

  function handleAddRow() {
    const fromId = newFrom.trim();
    const toId = newTo.trim();
    newCostDraft.commit();
    const cost = newCostCanonicalRef.current;

    if (!fromId || !toId) {
      setAddError("From ID and To ID are both required.");
      return;
    }
    if (cost == null || !Number.isFinite(cost) || cost <= 0) {
      setAddError("Cost must be a positive number.");
      return;
    }
    if (laneCostOverrides.some(o => o.fromId === fromId && o.toId === toId)) {
      setAddError("A lane cost override for this pair already exists — edit it in the table instead.");
      return;
    }

    setAddError(null);
    onChange([...laneCostOverrides, { fromId, toId, cost }]);
    setNewFrom("");
    setNewTo("");
    newCostDraft.discard();
    newCostCanonicalRef.current = null;
    setAddingRow(false);
  }

  function cancelAddRow() {
    setAddingRow(false);
    setNewFrom("");
    setNewTo("");
    newCostDraft.discard();
    newCostCanonicalRef.current = null;
    setAddError(null);
  }

  // Rebuilt every render: cells close over live props (see DistancesTab).
  const columns: ColumnDef<LaneCostOverride>[] = [
    {
      id: "from",
      header: "From (mine)",
      filterLabel: "From",
      kind: "text",
      filter: "text",
      value: o => o.fromId,
      cellClassName: "text-xs",
      cell: o => (
        <div className="flex items-center gap-1">
          <EntityIdCell entityId={o.fromId} displayId={resolvedDisplayId(o.fromId)} location={resolvedLocation(o.fromId)} />
          {!mineIdSet.has(o.fromId) && (
            <span
              title="Unknown mine ID — not found in this scenario's mines"
              data-testid={`warning-unknown-from-${o.fromId}-${o.toId}`}
            >
              <AlertTriangle className="w-3 h-3 text-amber-600" />
            </span>
          )}
        </div>
      ),
    },
    {
      id: "to",
      header: "To (station)",
      filterLabel: "To",
      kind: "text",
      filter: "text",
      value: o => o.toId,
      cellClassName: "text-xs",
      cell: o => (
        <div className="flex items-center gap-1">
          <EntityIdCell entityId={o.toId} displayId={resolvedDisplayId(o.toId)} location={resolvedLocation(o.toId)} />
          {!stationIdSet.has(o.toId) && (
            <span
              title="Unknown station ID — not found in this scenario's stations"
              data-testid={`warning-unknown-to-${o.fromId}-${o.toId}`}
            >
              <AlertTriangle className="w-3 h-3 text-amber-600" />
            </span>
          )}
        </div>
      ),
    },
    {
      id: "cost",
      header: unitSuffix("Cost"),
      filterLabel: "Cost",
      kind: "number",
      value: o => (canonicalUnit == null ? null : toDisplay(o.cost, canonicalUnit)),
      cell: o => (
        <div className="flex items-center justify-center gap-1.5">
          <LaneCostValueCell
            canonicalUnit={canonicalUnit}
            currentValue={o.cost}
            resetKey={scenarioId}
            onCommitValid={v => commitCost(o.fromId, o.toId, v)}
            inputTestId={`input-lanecost-${o.fromId}-${o.toId}`}
            readOnly={readOnly}
          />
          {isChanged(o) && (
            <span
              className="text-[10px] text-amber-700 bg-amber-100 border border-amber-300 rounded px-1"
              data-testid={`badge-lanecost-changed-${o.fromId}-${o.toId}`}
            >
              Changed
            </span>
          )}
        </div>
      ),
    },
    {
      id: "remove",
      header: "",
      kind: "text",
      filter: false,
      value: () => null,
      cell: o => (
        <button
          type="button"
          aria-label={`Remove lane cost override ${o.fromId} → ${o.toId}`}
          onClick={() => removeRow(o.fromId, o.toId)}
          disabled={readOnly}
          title={readOnly ? READ_ONLY_TITLE : undefined}
          data-testid={`button-remove-lanecost-${o.fromId}-${o.toId}`}
          className="text-muted-foreground hover:text-destructive disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      ),
    },
  ];

  const addRowUi = addingRow ? (
    <div className="flex items-start gap-1.5 mt-2" data-testid="add-lanecost-row-form">
      <Input
        placeholder="From ID (mine)"
        value={newFrom}
        onChange={e => setNewFrom(e.target.value)}
        className="h-7 text-xs w-36"
        data-testid="input-new-lanecost-from"
      />
      <Input
        placeholder="To ID (station)"
        value={newTo}
        onChange={e => setNewTo(e.target.value)}
        className="h-7 text-xs w-36"
        data-testid="input-new-lanecost-to"
      />
      <Input
        type="text"
        inputMode="decimal"
        placeholder={unitSuffix("Cost")}
        value={newCostText}
        disabled={newCostDraft.disabled}
        onChange={e => newCostDraft.onChange(e.target.value)}
        onBlur={newCostDraft.commit}
        onKeyDown={e => {
          if (e.key === "Enter") newCostDraft.commit();
          else if (e.key === "Escape") newCostDraft.discard();
        }}
        className="h-7 text-xs w-24 font-mono"
        data-testid="input-new-lanecost-value"
      />
      <Button size="sm" className="h-7 px-2 text-xs" onClick={handleAddRow} data-testid="button-add-lanecost-confirm">
        Add
      </Button>
      <Button
        size="sm"
        variant="ghost"
        className="h-7 px-2 text-xs"
        onClick={cancelAddRow}
        data-testid="button-add-lanecost-cancel"
      >
        Cancel
      </Button>
    </div>
  ) : (
    <Button
      size="sm"
      variant="outline"
      className="h-7 px-2 text-xs mt-2"
      onClick={() => setAddingRow(true)}
      disabled={readOnly}
      title={readOnly ? READ_ONLY_TITLE : undefined}
      data-testid="button-add-lanecost-row"
    >
      + Add row
    </Button>
  );

  return (
    <div data-testid="lanecosts-tab">
      <DataTable<LaneCostOverride>
        rows={laneCostOverrides}
        rowKey={o => pairKey(o.fromId, o.toId)}
        columns={columns}
        ctx={{ readOnly, demandEditable: false, isChanged }}
        rowClassName={(o, ctx) => (ctx.isChanged(o) ? "bg-amber-50" : undefined)}
        testIds={{
          toolbar: "lanecosts-tab-toolbar",
          row: o => `row-lanecost-${o.fromId}-${o.toId}`,
          pagerPrev: "button-lanecosts-prev",
          pagerNext: "button-lanecosts-next",
          pageIndicator: "lanecosts-page-indicator",
          empty: "lanecosts-tab-empty",
        }}
        toolbar={{ upload: files.upload, download: files.download }}
        scrollClassName="max-h-[55vh] overflow-y-auto"
        emptyState={
          <p className="text-sm text-muted-foreground">No lane cost overrides yet — add one below, or upload a CSV/JSON file.</p>
        }
        focus={
          focusEntityId ? { token: focusEntityId, matches: o => o.fromId === focusEntityId || o.toId === focusEntityId } : null
        }
      />
      {addRowUi}
      {addError && (
        <p className="text-[11px] text-destructive mt-1" data-testid="text-add-lanecost-error">
          {addError}
        </p>
      )}
      {files.dialog}
    </div>
  );
}
SCU_EOF
```

- [ ] **Step 5: Wire Workspace, flip the D2 guard, rewrite the by-design test breaks**

Adds `readOnly={isBrowsingHistoryNow}` to the `<LaneCostsTab` mount, flips the guard, rewrites `LaneCostsTab.test.tsx` by design (filter fixtures padded to 11 rows; menus):

```bash
python3 - <<'PY'
import pathlib
EDITS = [
    ('artifacts/studio/src/__tests__/LaneCostsTab.test.tsx',
     '''import { makeExportProviderValue } from "@/__tests__/helpers/renderWithExportProvider";
import { ExportProvider } from "@/contexts/ExportContext";

// chen-bands-units, Task 12 — every render now needs a UnitProvider ancestor.''',
     '''import { makeExportProviderValue } from "@/__tests__/helpers/renderWithExportProvider";
import { ExportProvider } from "@/contexts/ExportContext";
import { chooseInputDownload, chooseUpload, filterText } from "@/__tests__/helpers/inputTable";

// chen-bands-units, Task 12 — every render now needs a UnitProvider ancestor.'''),
    ('artifacts/studio/src/__tests__/LaneCostsTab.test.tsx',
     '''});

describe("LaneCostsTab — from/to filters", () => {
  it("filters visible rows by the from-id filter text", () => {
    render(
      <LaneCostsTab
        laneCostOverrides={overrides}
        savedLaneCostOverrides={overrides}
        mineIds={["MN01", "MN02"]}
        stationIds={["ST001", "ST002"]}''',
     '''});

// SCU-2.P4.6 (B2.2) — From/To are FilterMenu text controls, shown above 10
// rows: pad the three-row fixture with eight more MN03 rows.
const elevenOverrides = [
  ...overrides,
  ...Array.from({ length: 8 }, (_, i) => ({ fromId: "MN03", toId: `ST1${i}`, cost: 200 + i })),
];

describe("LaneCostsTab — from/to filters", () => {
  it("filters visible rows by the from-id filter text", () => {
    render(
      <LaneCostsTab
        laneCostOverrides={elevenOverrides}
        savedLaneCostOverrides={elevenOverrides}
        mineIds={["MN01", "MN02"]}
        stationIds={["ST001", "ST002"]}'''),
    ('artifacts/studio/src/__tests__/LaneCostsTab.test.tsx',
     '''      />,
    );
    fireEvent.change(screen.getByTestId("input-filter-from"), { target: { value: "MN02" } });
    expect(screen.queryByTestId("row-lanecost-MN01-ST001")).not.toBeInTheDocument();
    expect(screen.queryByTestId("row-lanecost-MN01-ST002")).not.toBeInTheDocument();''',
     '''      />,
    );
    filterText("from", "MN02");
    expect(screen.queryByTestId("row-lanecost-MN01-ST001")).not.toBeInTheDocument();
    expect(screen.queryByTestId("row-lanecost-MN01-ST002")).not.toBeInTheDocument();'''),
    ('artifacts/studio/src/__tests__/LaneCostsTab.test.tsx',
     '''
  it("filters visible rows by the to-id filter text", () => {
    render(
      <LaneCostsTab
        laneCostOverrides={overrides}
        savedLaneCostOverrides={overrides}
        mineIds={["MN01", "MN02"]}
        stationIds={["ST001", "ST002"]}
        onChange={vi.fn()}
      />,''',
     '''
  it("filters visible rows by the to-id filter text", () => {
    render(
      <LaneCostsTab
        laneCostOverrides={elevenOverrides}
        savedLaneCostOverrides={elevenOverrides}
        mineIds={["MN01", "MN02"]}
        stationIds={["ST001", "ST002"]}
        onChange={vi.fn()}
      />,'''),
    ('artifacts/studio/src/__tests__/LaneCostsTab.test.tsx',
     '''      />,
    );
    fireEvent.change(screen.getByTestId("input-filter-to"), { target: { value: "ST002" } });
    expect(screen.queryByTestId("row-lanecost-MN01-ST001")).not.toBeInTheDocument();
    expect(screen.getByTestId("row-lanecost-MN01-ST002")).toBeInTheDocument();''',
     '''      />,
    );
    filterText("to", "ST002");
    expect(screen.queryByTestId("row-lanecost-MN01-ST001")).not.toBeInTheDocument();
    expect(screen.getByTestId("row-lanecost-MN01-ST002")).toBeInTheDocument();'''),
    ('artifacts/studio/src/__tests__/LaneCostsTab.test.tsx',
     '''      { scenarioId: null },
    );
    expect(screen.getByTestId("button-export-lanecosts-csv")).toBeDisabled();
    expect(screen.getByTestId("button-export-lanecosts-json")).toBeDisabled();
    expect(screen.getByTestId("button-import-lanecosts")).toBeDisabled();
  });''',
     '''      { scenarioId: null },
    );
    // SCU-2.P4 (B2.3/B2.4) — one Download ▾ trigger now carries the disabled state.
    expect(screen.getByTestId("button-download-lanecosts")).toBeDisabled();
    expect(screen.getByTestId("button-import-lanecosts")).toBeDisabled();
  });'''),
    ('artifacts/studio/src/__tests__/LaneCostsTab.test.tsx',
     '''    );

    await userEvent.click(screen.getByTestId("button-export-lanecosts-csv"));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());''',
     '''    );

    chooseInputDownload("lanecosts", "csv");

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());'''),
    ('artifacts/studio/src/__tests__/LaneCostsTab.test.tsx',
     '''
    expect(screen.queryByText("Import laneCosts")).not.toBeInTheDocument();
    await userEvent.click(screen.getByTestId("button-import-lanecosts"));
    expect(screen.getByText("Import laneCosts")).toBeInTheDocument();
    expect(screen.getByTestId("input-import-file-laneCosts")).toBeInTheDocument();''',
     '''
    expect(screen.queryByText("Import laneCosts")).not.toBeInTheDocument();
    chooseUpload("lanecosts", "csv");
    expect(screen.getByText("Import laneCosts")).toBeInTheDocument();
    expect(screen.getByTestId("input-import-file-laneCosts")).toBeInTheDocument();'''),
    ('artifacts/studio/src/__tests__/LaneCostsTab.test.tsx',
     '    );\n\n    await userEvent.click(screen.getByTestId("button-import-lanecosts"));\n    const file = new File(["fromId,toId,cost\\nMN01,ST001,120.5"], "laneCosts.csv", { type: "text/csv" });\n    await userEvent.upload(screen.getByTestId("input-import-file-laneCosts"), file);',
     '    );\n\n    chooseUpload("lanecosts", "csv");\n    const file = new File(["fromId,toId,cost\\nMN01,ST001,120.5"], "laneCosts.csv", { type: "text/csv" });\n    await userEvent.upload(screen.getByTestId("input-import-file-laneCosts"), file);'),
    ('artifacts/studio/src/pages/Workspace.tsx',
     '''        <LaneCostsTab
''',
     '''        <LaneCostsTab
          readOnly={isBrowsingHistoryNow}
'''),
    ('artifacts/studio/src/__tests__/historyReadOnlyTabs.test.ts',
     '''  LaneCostsTab: "pending", // SCU-2.P4.6''',
     '''  LaneCostsTab: "readOnly", // SCU-2.P4.6'''),
]
for path, old, new in EDITS:
    f = pathlib.Path(path)
    s = f.read_text()
    n = s.count(old)
    if n != 1:
        raise SystemExit(f'STOP: {path}: anchor found {n} times (expected 1): {old[:80]!r}')
    f.write_text(s.replace(old, new, 1))
print(f'applied {len(EDITS)} edits')
PY
```

- [ ] **Step 6: Run the task's tests**

Run: `pnpm --filter studio exec vitest run src/__tests__/LaneCostsTab.dataTable.test.tsx src/__tests__/LaneCostsTab.test.tsx src/__tests__/historyReadOnlyTabs.test.ts`
Expected: PASS — 51 tests in 3 files (measured at plan time). Then `pnpm --filter studio typecheck` → exit 0.

- [ ] **Step 7: e2e sweep, rewrites and local run**

Sweep (matrix §3 prefixes for this instance; `labs.spec.ts` excluded):
```bash
grep -rn -E 'lanecosts-tab|row-lanecost-|input-lanecost-|button-export-lanecosts|button-import-lanecosts' artifacts/studio/e2e --include='*.ts' | grep -v labs.spec.ts
```
No rewrite needed: `bundle2-fastfollow.spec.ts` only counts `row-lanecost-*` (> 0 on page 1).

Then `pnpm --filter studio typecheck:e2e` (exit 0) and, with both local servers up (Global Constraints), run
```bash
cd artifacts/studio && E2E_BASE_URL=http://localhost:5179 npx playwright test e2e/bundle2-fastfollow.spec.ts
```
Expected: every test passes (a failure → flake registry by test name, two isolated re-runs, before calling it a regression). Record per-spec pass/fail in the changelog entry.

- [ ] **Step 8: Gate**

Run each separately (Global Constraints):
1. `cnt=$(ps aux | grep "[v]itest" | grep -v "zsh -c" | wc -l | tr -d ' '); [ "$cnt" = "0" ]`
2. `pnpm run typecheck`
3. `pnpm --filter studio typecheck:e2e`
4. `DATABASE_URL="postgresql://shubhamkr@localhost:5432/nos_dev" pnpm --filter api-server test`
5. `pnpm --filter studio test`
6. `(cd artifacts/api-server/src/solver && python3 -m pytest tests/ -x)`
7. `pnpm --filter @workspace/import-schema test`

Expected: every command exits 0. Then `git diff --stat "$P3_TIP"..HEAD -- artifacts/api-server lib/db lib/api-spec` prints nothing.

- [ ] **Step 9: Changelog**

Append to the bottom of `docs/CHANGELOG-implementation.md`:

```markdown

### SCU-2.P4.6 — Lane Costs on DataTable

- `LaneCostsTab` on DataTable: FilterMenu, pager > 50 (new), Upload ▾/Download ▾, D2 read-only, focus via DataTable.
- Deviations 3, 6, 7, 15, 17.
- Gate: studio <N passed>, api-server <N passed>, pytest <N passed>, import-schema <N passed>. e2e (local, `E2E_BASE_URL` set): <spec: pass/fail per spec>.
```

Replace each `<…>` with the value measured in this run, or the literal `unknown`.

- [ ] **Step 10: Commit**

```bash
git add artifacts/studio/src/__tests__/LaneCostsTab.dataTable.test.tsx
```

```bash
[ "$(git rev-parse --abbrev-ref HEAD)" != "main" ] || exit 1
```

```bash
git commit artifacts/studio/src/__tests__/LaneCostsTab.dataTable.test.tsx artifacts/studio/src/components/workspace/tabs/LaneCostsTab.tsx artifacts/studio/src/__tests__/LaneCostsTab.test.tsx artifacts/studio/src/pages/Workspace.tsx artifacts/studio/src/__tests__/historyReadOnlyTabs.test.ts docs/CHANGELOG-implementation.md -m "[SCU-2.P4.6] move Lane Costs onto DataTable" -m "FilterMenu replaces From/To, pager >50 (new), Upload/Download menus, D2 read-only. Deviations 3, 6, 7, 15, 17." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task SCU-2.P4.7: Delivery Costs on DataTable + `deliveryCosts` Upload/Download (delivery-teaching-us)

**Owner role:** frontend-engineer. **Matrix:** §1 #14, §2b DeliveryCosts. **Spec:** B2.1–B2.4, B2.7, D1, D2. **Deviations:** 3, 7, 15, 17.

**Files:**
- Create: `artifacts/studio/src/__tests__/DeliveryCostsTab.dataTable.test.tsx`
- Modify: `artifacts/studio/src/components/workspace/tabs/DeliveryCostsTab.tsx`
- Modify: `artifacts/studio/src/__tests__/DeliveryCostsTab.test.tsx`
- Modify: `artifacts/studio/src/pages/Workspace.tsx`
- Modify: `artifacts/studio/src/__tests__/historyReadOnlyTabs.test.ts`
- Modify: `artifacts/studio/e2e/delivery-teaching.spec.ts`
- Modify: `docs/CHANGELOG-implementation.md` (append `### SCU-2.P4.7`)

**Interfaces:**
- Consumes: as P4.3; P2's `deliveryCosts` entity (`ImportEntity`, `ExportEntity`, `INPUT_ENTITIES`).
- Produces: `DeliveryCostsTab` props `scenarioId?`, `onImportApplied?`, `readOnly?`; testids `button-import-deliverycosts(-csv|-json)`, `button-download-deliverycosts`, `button-export-deliverycosts-csv|json`.

**Behaviour changes (record each in the changelog):**
- Upload ▾ / Download ▾ for the sparse `deliveryCosts` entity (new — the tab had no file toolbar).
- From/To boxes → FilterMenu (+ Base/Cost ranges).
- Pager only above 50 rows (was always on) — matrix §5 item 2.
- History read-only on cost cells, remove and "+ Add row" (D2; they were never disabled). Inline "+ Add row" kept (B2.7).

- [ ] **Step 0: Invoke the simplicity skills**

Skill tool: `andrej-karpathy-skills:karpathy-guidelines`, then `ponytail:ponytail`. Record in the report that both ran (hard rule #12).

- [ ] **Step 1: Preconditions**

Run each line alone (worktree root):
```bash
cd /Users/shubhamkr/nos-scu-2.p4.7 && git rev-parse --abbrev-ref HEAD
git merge-base --is-ancestor "$BASE" HEAD || exit 1
git merge-base --is-ancestor "$B1_TIP" HEAD || exit 1
git merge-base --is-ancestor "$P3_TIP" HEAD || exit 1
test -f artifacts/studio/src/components/data-table/DataTable.tsx && test -f artifacts/studio/src/components/data-table/DownloadMenu.tsx && test -d lib/import-schema || exit 1
pnpm install --frozen-lockfile
```
Then confirm the files this task replaces wholesale are still the `46d2f98` text (Global Constraints):
```bash
git diff --quiet 46d2f98 HEAD -- artifacts/studio/src/components/workspace/tabs/DeliveryCostsTab.tsx || { echo 'STOP: artifacts/studio/src/components/workspace/tabs/DeliveryCostsTab.tsx changed since 46d2f98'; exit 1; }
```

- [ ] **Step 2: Write the failing test**

Create `artifacts/studio/src/__tests__/DeliveryCostsTab.dataTable.test.tsx`:

```bash
mkdir -p artifacts/studio/src/__tests__ && cat > artifacts/studio/src/__tests__/DeliveryCostsTab.dataTable.test.tsx <<'SCU_EOF'
// SCU-2.P4.7 — DeliveryCostsTab (delivery-teaching-us) on the shared
// DataTable with the sparse `deliveryCosts` Upload ▾ / Download ▾ (B2.3,
// B2.4, B2.7), the pager only above 50 rows (was always on), override-present
// amber, centred numbers and history read-only (D2).

import { useState } from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { AllProviders } from "@/__tests__/helpers/renderWithExportProvider";

const mockUseGetReferenceCosts = vi.fn();
vi.mock("@workspace/api-client-react", () => ({
  useGetReferenceCosts: (...args: unknown[]) => mockUseGetReferenceCosts(...args),
  getGetReferenceCostsQueryKey: vi.fn((id: string) => ["reference-costs", id]),
}));
const downloadEntityExport = vi.fn();
vi.mock("@/lib/exportEntity", () => ({ downloadEntityExport: (...a: unknown[]) => downloadEntityExport(...a) }));
vi.mock("@/components/ImportDialog", () => ({
  ImportDialog: (p: { entity: string; format: string }) => <div data-testid="stub-import-dialog" data-entity={p.entity} data-format={p.format} />,
}));

import { DeliveryCostsTab } from "@/components/workspace/tabs/DeliveryCostsTab";
import type { LaneCostOverride } from "@/components/workspace/tabs/LaneCostsTab";

function pairs(n: number) {
  return Array.from({ length: n }, (_, i) => ({ fromId: `W${(i % 33) + 1}`, fromCode: "", toId: `C${i + 1}`, toCode: "", cost: 10 + i }));
}

beforeEach(() => {
  mockUseGetReferenceCosts.mockReset();
  downloadEntityExport.mockReset();
  mockUseGetReferenceCosts.mockReturnValue({ data: { pairs: pairs(12), distanceUnit: "mi" }, isLoading: false, isError: false });
});

const renderTab = (props: Partial<React.ComponentProps<typeof DeliveryCostsTab>> = {}) =>
  render(
    <DeliveryCostsTab laneCostOverrides={[{ fromId: "W1", toId: "C1", cost: 99 }]} onChange={vi.fn()} modelId="delivery-teaching-us" scenarioId={3} {...props} />,
    { wrapper: AllProviders },
  );

describe("DeliveryCostsTab on DataTable (SCU-2.P4.7)", () => {
  it("emits every testid in the matrix map, plus the deliveryCosts menus", () => {
    renderTab();
    for (const id of [
      "delivery-costs-tab",
      "delivery-costs-tab-toolbar",
      "button-import-deliverycosts",
      "button-download-deliverycosts",
      "button-filter-menu-trigger",
      "row-deliverycost-W1-C1",
      "input-deliverycost-W1-C1",
      "badge-deliverycost-overridden-W1-C1",
      "button-remove-deliverycost-W1-C1",
      "button-add-deliverycost-row",
    ]) {
      expect(screen.getByTestId(id)).toBeInTheDocument();
    }
  });

  it("Download ▾ exports the deliveryCosts entity; Upload ▾ opens the dialog for it", () => {
    renderTab();
    fireEvent.click(screen.getByTestId("button-download-deliverycosts"));
    fireEvent.click(screen.getByTestId("button-export-deliverycosts-json"));
    expect(downloadEntityExport).toHaveBeenCalledWith(1, "deliveryCosts", "json", { unit: "mi", runId: undefined });
    fireEvent.click(screen.getByTestId("button-import-deliverycosts"));
    fireEvent.click(screen.getByTestId("button-import-deliverycosts-csv"));
    expect(screen.getByTestId("stub-import-dialog")).toHaveAttribute("data-entity", "deliveryCosts");
  });

  it("the pager is hidden at ≤ 50 rows and shown above 50 (it was always on)", () => {
    const { unmount } = renderTab();
    expect(screen.queryByTestId("delivery-costs-page-indicator")).toBeNull();
    unmount();
    mockUseGetReferenceCosts.mockReturnValue({ data: { pairs: pairs(51), distanceUnit: "mi" }, isLoading: false, isError: false });
    renderTab();
    expect(screen.getByTestId("delivery-costs-page-indicator")).toHaveTextContent("Page 1 of 2");
  });

  it("loading / error states keep their testids", () => {
    mockUseGetReferenceCosts.mockReturnValue({ data: undefined, isLoading: true, isError: false });
    const { unmount } = renderTab();
    expect(screen.getByTestId("delivery-costs-tab-loading")).toHaveTextContent("Loading cost data");
    unmount();
    mockUseGetReferenceCosts.mockReturnValue({ data: undefined, isLoading: false, isError: true });
    renderTab();
    expect(screen.getByTestId("delivery-costs-tab-error")).toHaveTextContent("Failed to load cost data");
  });

  it("amber marks override-present rows; numbers centred", () => {
    renderTab();
    expect(screen.getByTestId("row-deliverycost-W1-C1")).toHaveClass("bg-amber-50");
    expect(screen.getByTestId("row-deliverycost-W2-C2")).not.toHaveClass("bg-amber-50");
    const headers = within(screen.getByTestId("delivery-costs-tab")).getAllByRole("columnheader");
    expect(headers.map(h => h.textContent)).toEqual(["From", "To", "Base", "Cost", ""]);
    expect(headers[2]).toHaveClass("text-center");
    expect(headers[3]).toHaveClass("text-center");
  });

  it("history read-only (D2): cost cells, remove and the add trigger are disabled", () => {
    renderTab({ readOnly: true });
    expect(screen.getByTestId("input-deliverycost-W1-C1")).toBeDisabled();
    expect(screen.getByTestId("input-deliverycost-W2-C2")).toBeDisabled();
    expect(screen.getByTestId("button-remove-deliverycost-W1-C1")).toBeDisabled();
    expect(screen.getByTestId("button-add-deliverycost-row")).toBeDisabled();
  });

  it("edit round-trip: a base row's cost becomes an override", () => {
    function Parent() {
      const [r, setR] = useState<LaneCostOverride[]>([]);
      return <DeliveryCostsTab laneCostOverrides={r} onChange={setR} modelId="delivery-teaching-us" />;
    }
    render(<Parent />, { wrapper: AllProviders });
    fireEvent.change(screen.getByTestId("input-deliverycost-W2-C2"), { target: { value: "0" } });
    fireEvent.blur(screen.getByTestId("input-deliverycost-W2-C2"));
    expect(screen.getByTestId("badge-deliverycost-overridden-W2-C2")).toBeInTheDocument();
    expect(screen.getByTestId("row-deliverycost-W2-C2")).toHaveClass("bg-amber-50");
  });
});
SCU_EOF
```

- [ ] **Step 3: Run it to verify it fails**

Run: `pnpm --filter studio exec vitest run src/__tests__/DeliveryCostsTab.dataTable.test.tsx`
Expected: FAIL — `Tests  5 failed | 2 passed (7)` (measured at plan time against the pre-migration tab) — the history test finds enabled controls (and `readOnly` is not yet a prop — a type error under `pnpm --filter studio typecheck`), and the menu/filter/centring assertions find today's single buttons, From/To boxes and left-aligned numbers.

- [ ] **Step 4: Implement — `DeliveryCostsTab.tsx`**

Replace the whole file `artifacts/studio/src/components/workspace/tabs/DeliveryCostsTab.tsx` with:

```bash
mkdir -p artifacts/studio/src/components/workspace/tabs && cat > artifacts/studio/src/components/workspace/tabs/DeliveryCostsTab.tsx <<'SCU_EOF'
import { useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";
import type { Scenario } from "@workspace/api-client-react";
import { useGetReferenceCosts, getGetReferenceCostsQueryKey } from "@workspace/api-client-react";
import { Input } from "@/components/ui/input";
import { DataTable } from "@/components/data-table/DataTable";
import type { ColumnDef } from "@/components/data-table/types";
import { useEntityFileMenus } from "@/components/data-table/useEntityFileMenus";
import { Button } from "@/components/ui/button";
import type { LaneCostOverride } from "@/components/workspace/tabs/LaneCostsTab";

// Task 11 — delivery-teaching-us's Delivery Costs tab, this model's ONLY
// editable dataset surface (spec decision 11; inputEntriesForModel's own
// comment). Modelled on DistancesTab.tsx's merged base+override
// architecture (baseByKey/overrideByKey/mergedRows, PAGE_SIZE=50,
// fromFilter/toFilter, a typed-id add row) but DELIBERATELY simpler in two
// ways this model doesn't need:
//   1. No warehouseIds/customerIds "unknown id" warning — delivery-teaching-us
//      has no add/delete-entity flow (no addedWarehouses/addedCustomers in
//      its inputs shape), so every id a student can type already resolves
//      against the fixed 33x313 base dataset or is a plain typo, not a
//      legitimate scenario-local id.
//   2. (SCU-2.P4.7 — superseded) Upload ▾ / Download ▾ now exist: the sparse
//      `deliveryCosts` import/export entity (spec B2.7, D1) landed in P2.
//
// The critical divergence from DistancesTab is semantic, not structural: a
// `cost` here is billable miles, NOT a distance — it must never round-trip
// through `useDistanceDraft` or any canonicalUnit conversion (that machinery
// exists precisely to convert between mi/km for actual distances; applying
// it to a cost value would silently corrupt it). Every cell here is a plain
// controlled number input. Validation is NON-negative (cost >= 0), not
// strictly positive — the dataset ships 33 zero-cost self-lanes (warehouse
// co-located with a customer), so 0 is legal data, not an error.

interface DeliveryCostsTabProps {
  /** The scenario's CURRENT laneCostOverrides array (localInputs draft) — no
   * fixed baseline to enumerate (mirrors DistancesTab/LaneCostsTab's own
   * reasoning): this grid shows exactly what the student has explicitly set,
   * merged against the immutable base matrix for display. */
  laneCostOverrides: LaneCostOverride[];
  onChange: (next: LaneCostOverride[]) => void;
  /** The active model's id — always "delivery-teaching-us" in practice (the
   * only model with this tab), passed through rather than hardcoded so the
   * component doesn't need a Workspace.tsx-specific import. Optional/undefined
   * while the scenario hasn't resolved yet, mirroring DistancesTab's own
   * `enabled` gate — the base query never fires without it. */
  modelId?: string;
  /** SCU-2.P4.7 (B2.3/B2.4) — Upload stays disabled until the scenario resolves. */
  scenarioId?: number;
  /** Fired after a successful import apply (Workspace refreshes its draft). */
  onImportApplied?: (scenario: Scenario) => void;
  /** SCU-2.P4.7 (D2) — browsing result history: cost cells, remove buttons and
   * the add-row trigger are disabled. */
  readOnly?: boolean;
}

function pairKey(fromId: string, toId: string): string {
  return `${fromId}|${toId}`;
}

interface MergedRow {
  fromId: string;
  toId: string;
  base: number | null;
  override?: LaneCostOverride;
}

const READ_ONLY_TITLE = "Read-only while browsing result history.";

// One row's Cost cell — a plain controlled text input with local draft
// state, committed on blur/Enter. NOT `useDistanceDraft` (see the file
// header comment) — there is no unit to convert, so there is no grammar to
// track beyond "is this a non-negative finite number".
function CostCell({
  currentValue,
  resetKey,
  onCommitValid,
  inputTestId,
  readOnly,
}: {
  currentValue: number | undefined;
  resetKey: unknown;
  onCommitValid: (value: number) => void;
  inputTestId: string;
  readOnly: boolean;
}) {
  const [draft, setDraft] = useState<string | null>(null);

  // Discard any in-progress draft when this row's identity/override
  // presence changes out from under it (scenario switch, or the trash-icon
  // clearing this exact row mid-edit) — mirrors DistanceOverrideCell's own
  // resetKey contract.
  useEffect(() => {
    setDraft(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey]);

  const text = draft ?? (currentValue == null ? "" : String(currentValue));

  function commit() {
    if (draft == null) return;
    const trimmed = draft.trim();
    if (trimmed === "") {
      setDraft(null);
      return;
    }
    const numeric = Number(trimmed);
    if (Number.isFinite(numeric) && numeric >= 0) {
      onCommitValid(numeric);
    }
    setDraft(null);
  }

  return (
    <Input
      type="text"
      inputMode="decimal"
      value={text}
      disabled={readOnly}
      title={readOnly ? READ_ONLY_TITLE : undefined}
      onChange={e => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={e => {
        if (e.key === "Enter") commit();
        else if (e.key === "Escape") setDraft(null);
      }}
      className="h-7 text-xs w-full min-w-24 font-mono"
      data-testid={inputTestId}
    />
  );
}

// SCU-2.P4.7 (B2.1–B2.4, B2.7) — rendered by the shared DataTable: FilterMenu
// replaces the From/To boxes, the pager shows only above 50 filtered rows
// (it was always on), Upload ▾/Download ▾ use the sparse `deliveryCosts`
// entity, amber stays "override present", history read-only (D2).
export function DeliveryCostsTab({
  laneCostOverrides,
  onChange,
  modelId,
  scenarioId,
  onImportApplied,
  readOnly = false,
}: DeliveryCostsTabProps) {
  const files = useEntityFileMenus({
    entity: "deliveryCosts",
    testIdEntity: "deliverycosts",
    modelId,
    scenarioId,
    onImportApplied,
  });
  const [addingRow, setAddingRow] = useState(false);
  const [newFrom, setNewFrom] = useState("");
  const [newTo, setNewTo] = useState("");
  const [newCost, setNewCost] = useState("");
  const [addError, setAddError] = useState<string | null>(null);

  const referenceQuery = useGetReferenceCosts(modelId ?? "", {
    query: {
      enabled: Boolean(modelId),
      staleTime: Infinity,
      queryKey: getGetReferenceCostsQueryKey(modelId ?? ""),
    },
  });
  const referencePairs = useMemo(() => referenceQuery.data?.pairs ?? [], [referenceQuery.data]);

  const baseByKey = useMemo(() => new Map(referencePairs.map(p => [pairKey(p.fromId, p.toId), p.cost])), [referencePairs]);
  const overrideByKey = useMemo(() => new Map(laneCostOverrides.map(o => [pairKey(o.fromId, o.toId), o])), [laneCostOverrides]);

  // Effective rows (B2.2 step 1): the whole base matrix, then overrides for
  // pairs outside it — the same base-then-added order the old two-segment
  // pager sliced. Memoised: ~10k rows, and DataTable keys its page reset on
  // this array's identity.
  const rows: MergedRow[] = useMemo(
    () => [
      ...referencePairs.map(p => ({
        fromId: p.fromId,
        toId: p.toId,
        base: p.cost,
        override: overrideByKey.get(pairKey(p.fromId, p.toId)),
      })),
      ...laneCostOverrides
        .filter(o => !baseByKey.has(pairKey(o.fromId, o.toId)))
        .map(o => ({ fromId: o.fromId, toId: o.toId, base: null, override: o })),
    ],
    [referencePairs, laneCostOverrides, baseByKey, overrideByKey],
  );

  function commitOverride(r: MergedRow, cost: number) {
    const key = pairKey(r.fromId, r.toId);
    const next: LaneCostOverride = { fromId: r.fromId, toId: r.toId, cost };
    onChange(
      overrideByKey.has(key)
        ? laneCostOverrides.map(o => (pairKey(o.fromId, o.toId) === key ? next : o))
        : [...laneCostOverrides, next],
    );
  }

  function clearOverride(r: MergedRow) {
    const key = pairKey(r.fromId, r.toId);
    onChange(laneCostOverrides.filter(o => pairKey(o.fromId, o.toId) !== key));
  }

  function handleAddRow() {
    const fromId = newFrom.trim();
    const toId = newTo.trim();
    const trimmedCost = newCost.trim();

    if (!fromId || !toId) {
      setAddError("From ID and To ID are both required.");
      return;
    }
    if (referencePairs.length > 0 && !referencePairs.some(p => p.fromId === fromId)) {
      setAddError(`Unknown warehouse id "${fromId}" — not found in the base cost matrix.`);
      return;
    }
    if (referencePairs.length > 0 && !referencePairs.some(p => p.toId === toId)) {
      setAddError(`Unknown customer id "${toId}" — not found in the base cost matrix.`);
      return;
    }
    const cost = trimmedCost === "" ? NaN : Number(trimmedCost);
    if (!Number.isFinite(cost) || cost < 0) {
      setAddError("Cost must be a non-negative number.");
      return;
    }
    if (laneCostOverrides.some(o => o.fromId === fromId && o.toId === toId)) {
      setAddError("A cost override for this pair already exists — edit it in the table instead.");
      return;
    }

    setAddError(null);
    onChange([...laneCostOverrides, { fromId, toId, cost }]);
    setNewFrom("");
    setNewTo("");
    setNewCost("");
    setAddingRow(false);
  }

  function cancelAddRow() {
    setAddingRow(false);
    setNewFrom("");
    setNewTo("");
    setNewCost("");
    setAddError(null);
  }

  // Rebuilt every render: cells close over live props (see DistancesTab).
  const columns: ColumnDef<MergedRow>[] = [
    {
      id: "from",
      header: "From",
      kind: "text",
      filter: "text",
      value: r => r.fromId,
      cellClassName: "text-xs font-mono",
      cell: r => r.fromId,
    },
    {
      id: "to",
      header: "To",
      kind: "text",
      filter: "text",
      value: r => r.toId,
      cellClassName: "text-xs font-mono",
      cell: r => r.toId,
    },
    {
      id: "base",
      header: "Base",
      kind: "number",
      value: r => r.base,
      cellClassName: "font-mono text-xs",
      cell: r => (r.base == null ? "—" : r.base),
    },
    {
      id: "cost",
      header: "Cost",
      kind: "number",
      value: r => r.override?.cost ?? null,
      cell: r => (
        <div className="flex items-center justify-center gap-1.5">
          <CostCell
            currentValue={r.override?.cost}
            resetKey={`${pairKey(r.fromId, r.toId)}:${r.override ? "1" : "0"}`}
            onCommitValid={v => commitOverride(r, v)}
            inputTestId={`input-deliverycost-${r.fromId}-${r.toId}`}
            readOnly={readOnly}
          />
          {r.override && (
            <span
              className="text-[10px] text-amber-700 bg-amber-100 border border-amber-300 rounded px-1"
              data-testid={`badge-deliverycost-overridden-${r.fromId}-${r.toId}`}
            >
              Overridden
            </span>
          )}
        </div>
      ),
    },
    {
      id: "remove",
      header: "",
      kind: "text",
      filter: false,
      value: () => null,
      cell: r =>
        (r.override || r.base == null) && (
          <button
            type="button"
            aria-label={`Remove cost override ${r.fromId} → ${r.toId}`}
            onClick={() => clearOverride(r)}
            disabled={readOnly}
            title={readOnly ? READ_ONLY_TITLE : undefined}
            data-testid={`button-remove-deliverycost-${r.fromId}-${r.toId}`}
            className="text-muted-foreground hover:text-destructive disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        ),
    },
  ];

  const addRowUi = addingRow ? (
    <div className="flex items-start gap-1.5 mt-2" data-testid="add-deliverycost-row-form">
      <Input
        placeholder="From ID (warehouse)"
        value={newFrom}
        onChange={e => setNewFrom(e.target.value)}
        className="h-7 text-xs w-36"
        data-testid="input-new-deliverycost-from"
      />
      <Input
        placeholder="To ID (customer)"
        value={newTo}
        onChange={e => setNewTo(e.target.value)}
        className="h-7 text-xs w-36"
        data-testid="input-new-deliverycost-to"
      />
      <Input
        type="text"
        inputMode="decimal"
        placeholder="Cost"
        value={newCost}
        onChange={e => setNewCost(e.target.value)}
        className="h-7 text-xs w-24 font-mono"
        data-testid="input-new-deliverycost-value"
      />
      <Button size="sm" className="h-7 px-2 text-xs" onClick={handleAddRow} data-testid="button-add-deliverycost-confirm">
        Add
      </Button>
      <Button
        size="sm"
        variant="ghost"
        className="h-7 px-2 text-xs"
        onClick={cancelAddRow}
        data-testid="button-add-deliverycost-cancel"
      >
        Cancel
      </Button>
    </div>
  ) : (
    <Button
      size="sm"
      variant="outline"
      className="h-7 px-2 text-xs mt-2"
      onClick={() => setAddingRow(true)}
      disabled={readOnly}
      title={readOnly ? READ_ONLY_TITLE : undefined}
      data-testid="button-add-deliverycost-row"
    >
      + Add row
    </Button>
  );

  // Loading / error / no data replace the table (toolbar stays), each with
  // its own testid — DataTable renders `emptyState` inside `testIds.empty`.
  const emptyTestId = referenceQuery.isLoading
    ? "delivery-costs-tab-loading"
    : referenceQuery.isError
      ? "delivery-costs-tab-error"
      : "delivery-costs-tab-empty";
  const emptyState = referenceQuery.isLoading ? (
    <p className="text-sm text-muted-foreground">Loading cost data…</p>
  ) : referenceQuery.isError ? (
    <p className="text-sm text-destructive">Failed to load cost data — try reloading the page.</p>
  ) : (
    <p className="text-sm text-muted-foreground">No cost data yet — add an override below.</p>
  );

  return (
    <div data-testid="delivery-costs-tab">
      <DataTable<MergedRow>
        rows={referenceQuery.isLoading || referenceQuery.isError ? [] : rows}
        rowKey={r => pairKey(r.fromId, r.toId)}
        columns={columns}
        ctx={{ readOnly, demandEditable: false, isOverridden: r => r.override != null }}
        rowClassName={(r, ctx) => (ctx.isOverridden(r) ? "bg-amber-50" : undefined)}
        testIds={{
          toolbar: "delivery-costs-tab-toolbar",
          row: r => `row-deliverycost-${r.fromId}-${r.toId}`,
          pagerPrev: "button-delivery-costs-prev",
          pagerNext: "button-delivery-costs-next",
          pageIndicator: "delivery-costs-page-indicator",
          empty: emptyTestId,
        }}
        toolbar={{ upload: files.upload, download: files.download }}
        scrollClassName="max-h-[55vh] overflow-y-auto"
        emptyState={emptyState}
      />
      {addRowUi}
      {addError && (
        <p className="text-[11px] text-destructive mt-1" data-testid="text-add-deliverycost-error">
          {addError}
        </p>
      )}
      {files.dialog}
    </div>
  );
}
SCU_EOF
```

- [ ] **Step 5: Wire Workspace, flip the D2 guard, rewrite the by-design test breaks**

Wires `scenarioId`, `onImportApplied`, `readOnly` on the `<DeliveryCostsTab` mount (and updates its comment), flips the guard, and rewrites `DeliveryCostsTab.test.tsx`'s render seam (the menus need `ExportProvider`) and its two filter tests (fixtures padded to 11 rows). The add-row tests stay unchanged (P2 / B2.7):

```bash
python3 - <<'PY'
import pathlib
EDITS = [
    ('artifacts/studio/src/__tests__/DeliveryCostsTab.test.tsx',
     '''import { useState } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// Task 11 — DeliveryCostsTab is modelled directly on DistancesTab.tsx's''',
     '''import { useState } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render as rtlRender, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AllProviders } from "@/__tests__/helpers/renderWithExportProvider";

// SCU-2.P4.7 — the tab now renders Upload ▾ / Download ▾ (useExport), which
// needs the ExportProvider; AllProviders supplies it (and UnitProvider).
function render(ui: Parameters<typeof rtlRender>[0]) {
  return rtlRender(ui, { wrapper: AllProviders });
}

// Task 11 — DeliveryCostsTab is modelled directly on DistancesTab.tsx's'''),
    ('artifacts/studio/src/__tests__/DeliveryCostsTab.test.tsx',
     '''
import { DeliveryCostsTab } from "@/components/workspace/tabs/DeliveryCostsTab";

interface Pair {''',
     '''
import { DeliveryCostsTab } from "@/components/workspace/tabs/DeliveryCostsTab";
import { filterText } from "@/__tests__/helpers/inputTable";

interface Pair {'''),
    ('artifacts/studio/src/__tests__/DeliveryCostsTab.test.tsx',
     '''  });

  it("filters by from-id substring", () => {
    const overrides = [
      { fromId: "W1", toId: "C1", cost: 10 },
      { fromId: "W2", toId: "C1", cost: 20 },
    ];
    render(<DeliveryCostsTab laneCostOverrides={overrides} onChange={vi.fn()} />);

    fireEvent.change(screen.getByTestId("input-filter-from"), { target: { value: "W2" } });

    expect(screen.queryByTestId("row-deliverycost-W1-C1")).not.toBeInTheDocument();''',
     '''  });

  // SCU-2.P4.7 (B2.2) — From/To are FilterMenu text controls, shown above
  // 10 rows: both filter fixtures carry 9 extra W9 rows.
  const padding = Array.from({ length: 9 }, (_, i) => ({ fromId: "W9", toId: `C9${i}`, cost: 30 + i }));

  it("filters by from-id substring", () => {
    const overrides = [
      { fromId: "W1", toId: "C1", cost: 10 },
      { fromId: "W2", toId: "C1", cost: 20 },
      ...padding,
    ];
    render(<DeliveryCostsTab laneCostOverrides={overrides} onChange={vi.fn()} />);

    filterText("from", "W2");

    expect(screen.queryByTestId("row-deliverycost-W1-C1")).not.toBeInTheDocument();'''),
    ('artifacts/studio/src/__tests__/DeliveryCostsTab.test.tsx',
     '''      { fromId: "W1", toId: "C1", cost: 10 },
      { fromId: "W1", toId: "C2", cost: 20 },
    ];
    render(<DeliveryCostsTab laneCostOverrides={overrides} onChange={vi.fn()} />);

    fireEvent.change(screen.getByTestId("input-filter-to"), { target: { value: "C2" } });

    expect(screen.queryByTestId("row-deliverycost-W1-C1")).not.toBeInTheDocument();''',
     '''      { fromId: "W1", toId: "C1", cost: 10 },
      { fromId: "W1", toId: "C2", cost: 20 },
      ...padding,
    ];
    render(<DeliveryCostsTab laneCostOverrides={overrides} onChange={vi.fn()} />);

    filterText("to", "C2");

    expect(screen.queryByTestId("row-deliverycost-W1-C1")).not.toBeInTheDocument();'''),
    ('artifacts/studio/src/pages/Workspace.tsx',
     '''    // miles, not a distance, so no canonicalUnit/Upload/Download wiring.''',
     '''    // miles, not a distance, so no canonicalUnit wiring. SCU-2.P4.7 — Upload ▾/
    // Download ▾ use the sparse `deliveryCosts` entity (spec B2.7, D1).'''),
    ('artifacts/studio/src/pages/Workspace.tsx',
     '''          onChange={next => updateInputsField("laneCostOverrides", next)}
          modelId={modelId}
        />''',
     '''          onChange={next => updateInputsField("laneCostOverrides", next)}
          modelId={modelId}
          scenarioId={currentScenario?.id}
          onImportApplied={handleImportApplied}
          readOnly={isBrowsingHistoryNow}
        />'''),
    ('artifacts/studio/src/__tests__/historyReadOnlyTabs.test.ts',
     '''  DeliveryCostsTab: "pending", // SCU-2.P4.7''',
     '''  DeliveryCostsTab: "readOnly", // SCU-2.P4.7'''),
]
for path, old, new in EDITS:
    f = pathlib.Path(path)
    s = f.read_text()
    n = s.count(old)
    if n != 1:
        raise SystemExit(f'STOP: {path}: anchor found {n} times (expected 1): {old[:80]!r}')
    f.write_text(s.replace(old, new, 1))
print(f'applied {len(EDITS)} edits')
PY
```

- [ ] **Step 6: Run the task's tests**

Run: `pnpm --filter studio exec vitest run src/__tests__/DeliveryCostsTab.dataTable.test.tsx src/__tests__/DeliveryCostsTab.test.tsx src/__tests__/historyReadOnlyTabs.test.ts`
Expected: PASS — 36 tests in 3 files (measured at plan time). Then `pnpm --filter studio typecheck` → exit 0.

- [ ] **Step 7: e2e sweep, rewrites and local run**

Sweep (matrix §3 prefixes for this instance; `labs.spec.ts` excluded):
```bash
grep -rn -E 'delivery-costs-|row-deliverycost-|input-deliverycost-|badge-deliverycost-|input-filter-(from|to)' artifacts/studio/e2e --include='*.ts' | grep -v labs.spec.ts
```
Rewritten below: the From/To fills. Unchanged: `delivery-costs-tab`, `input-deliverycost-*`, `badge-deliverycost-overridden-*`; no spec touches the pager.

Apply the rewrites (each anchor is asserted unique; verified against the Bundle 1 tip `e2e/` tree and type-checked at plan time):

```bash
python3 - <<'PY'
import pathlib
EDITS = [
    ('artifacts/studio/e2e/delivery-teaching.spec.ts',
     '''import { test, expect, type Page } from "./fixtures";
''',
     '''import { test, expect, type Page } from "./fixtures";
import { closePopover, fillTableFilter } from "./helpers/inputTable";
'''),
    ('artifacts/studio/e2e/delivery-teaching.spec.ts',
     '''    await page.getByTestId("input-filter-from").fill(OVERRIDE_LANE.fromId);
    await page.getByTestId("input-filter-to").fill(OVERRIDE_LANE.toId);''',
     '''    // SCU-2.P4.7 (B2.2) — FilterMenu text controls replace the From/To boxes.
    await fillTableFilter(page, "from", OVERRIDE_LANE.fromId);
    await fillTableFilter(page, "to", OVERRIDE_LANE.toId);
    await closePopover(page);'''),
]
for path, old, new in EDITS:
    f = pathlib.Path(path)
    s = f.read_text()
    n = s.count(old)
    if n != 1:
        raise SystemExit(f'STOP: {path}: anchor found {n} times (expected 1): {old[:80]!r}')
    f.write_text(s.replace(old, new, 1))
print(f'applied {len(EDITS)} edits')
PY
```

Then `pnpm --filter studio typecheck:e2e` (exit 0) and, with both local servers up (Global Constraints), run
```bash
cd artifacts/studio && E2E_BASE_URL=http://localhost:5179 npx playwright test e2e/delivery-teaching.spec.ts
```
Expected: every test passes (a failure → flake registry by test name, two isolated re-runs, before calling it a regression). Record per-spec pass/fail in the changelog entry.

- [ ] **Step 8: Gate**

Run each separately (Global Constraints):
1. `cnt=$(ps aux | grep "[v]itest" | grep -v "zsh -c" | wc -l | tr -d ' '); [ "$cnt" = "0" ]`
2. `pnpm run typecheck`
3. `pnpm --filter studio typecheck:e2e`
4. `DATABASE_URL="postgresql://shubhamkr@localhost:5432/nos_dev" pnpm --filter api-server test`
5. `pnpm --filter studio test`
6. `(cd artifacts/api-server/src/solver && python3 -m pytest tests/ -x)`
7. `pnpm --filter @workspace/import-schema test`

Expected: every command exits 0. Then `git diff --stat "$P3_TIP"..HEAD -- artifacts/api-server lib/db lib/api-spec` prints nothing.

- [ ] **Step 9: Changelog**

Append to the bottom of `docs/CHANGELOG-implementation.md`:

```markdown

### SCU-2.P4.7 — Delivery Costs on DataTable + `deliveryCosts` Upload/Download

- `DeliveryCostsTab` on DataTable: Upload ▾/Download ▾ for `deliveryCosts` (sparse, D1), FilterMenu, pager > 50 only (was always on), override-present amber kept, D2 read-only, loading/error/empty testids kept.
- Deviations 3, 7, 15, 17.
- Gate: studio <N passed>, api-server <N passed>, pytest <N passed>, import-schema <N passed>. e2e (local, `E2E_BASE_URL` set): <spec: pass/fail per spec>.
```

Replace each `<…>` with the value measured in this run, or the literal `unknown`.

- [ ] **Step 10: Commit**

```bash
git add artifacts/studio/src/__tests__/DeliveryCostsTab.dataTable.test.tsx
```

```bash
[ "$(git rev-parse --abbrev-ref HEAD)" != "main" ] || exit 1
```

```bash
git commit artifacts/studio/src/__tests__/DeliveryCostsTab.dataTable.test.tsx artifacts/studio/src/components/workspace/tabs/DeliveryCostsTab.tsx artifacts/studio/src/__tests__/DeliveryCostsTab.test.tsx artifacts/studio/src/pages/Workspace.tsx artifacts/studio/src/__tests__/historyReadOnlyTabs.test.ts artifacts/studio/e2e/delivery-teaching.spec.ts docs/CHANGELOG-implementation.md -m "[SCU-2.P4.7] move Delivery Costs onto DataTable with deliveryCosts upload/download" -m "Sparse deliveryCosts Upload/Download (B2.7, D1), FilterMenu, pager >50 only, D2 read-only; inline + Add row kept. Deviations 3, 7, 15, 17." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task SCU-2.P4.8: JADE Transport Costs on DataTable (no Upload/Download)

**Owner role:** frontend-engineer. **Matrix:** §1 #15, §2b TransportCosts. **Spec:** B2.1 (rendering), B2.3/B2.4 exclusion. **Deviations:** 3.

**Files:**
- Create: `artifacts/studio/src/__tests__/TransportCostsTab.dataTable.test.tsx`
- Modify: `artifacts/studio/src/components/workspace/tabs/TransportCostsTab.tsx`
- Modify: `docs/CHANGELOG-implementation.md` (append `### SCU-2.P4.8`)

**Interfaces:**
- Consumes: `DataTable`, `ColumnDef` (P1).
- Produces: no prop change (history already via `disabled`); `label-transport-rate-unit-head` now on the `<th>` through `headerTestId` (same element).

**Behaviour changes (record each in the changelog):**
- Rendered through DataTable (two fixed rows: no filter, no pager); numbers centred; inputs `w-full`. No Upload/Download (spec scope).

- [ ] **Step 0: Invoke the simplicity skills**

Skill tool: `andrej-karpathy-skills:karpathy-guidelines`, then `ponytail:ponytail`. Record in the report that both ran (hard rule #12).

- [ ] **Step 1: Preconditions**

Run each line alone (worktree root):
```bash
cd /Users/shubhamkr/nos-scu-2.p4.8 && git rev-parse --abbrev-ref HEAD
git merge-base --is-ancestor "$BASE" HEAD || exit 1
git merge-base --is-ancestor "$B1_TIP" HEAD || exit 1
git merge-base --is-ancestor "$P3_TIP" HEAD || exit 1
test -f artifacts/studio/src/components/data-table/DataTable.tsx && test -f artifacts/studio/src/components/data-table/DownloadMenu.tsx && test -d lib/import-schema || exit 1
pnpm install --frozen-lockfile
```
Then confirm the files this task replaces wholesale are still the `46d2f98` text (Global Constraints):
```bash
git diff --quiet 46d2f98 HEAD -- artifacts/studio/src/components/workspace/tabs/TransportCostsTab.tsx || { echo 'STOP: artifacts/studio/src/components/workspace/tabs/TransportCostsTab.tsx changed since 46d2f98'; exit 1; }
```

- [ ] **Step 2: Write the failing test**

Create `artifacts/studio/src/__tests__/TransportCostsTab.dataTable.test.tsx`:

```bash
mkdir -p artifacts/studio/src/__tests__ && cat > artifacts/studio/src/__tests__/TransportCostsTab.dataTable.test.tsx <<'SCU_EOF'
// SCU-2.P4.8 — TransportCostsTab (JADE) on the shared DataTable (B2.1): the
// matrix testids survive (incl. the header testid on the <th>), numbers are
// centred, no filter/pager at two rows, and history read-only still disables
// all four fields and Reset (D2 — this tab already had it).

import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { UnitProvider } from "@/contexts/UnitContext";
import { TransportCostsTab } from "@/components/workspace/tabs/TransportCostsTab";
import { TEXTBOOK_TRANSPORT_COSTS } from "@/lib/transportCosts";

const renderTab = (disabled = false) =>
  render(
    <UnitProvider>
      <TransportCostsTab
        canonicalUnit="mi"
        transportCosts={TEXTBOOK_TRANSPORT_COSTS}
        isCustom
        onChange={vi.fn()}
        onReset={vi.fn()}
        scenarioId={1}
        disabled={disabled}
      />
    </UnitProvider>,
  );

describe("TransportCostsTab on DataTable (SCU-2.P4.8)", () => {
  it("emits every testid in the matrix map; the rate-unit header testid sits on the <th>", () => {
    renderTab();
    for (const id of [
      "transport-costs-tab",
      "label-transport-rate-unit-head",
      "row-transport-ic",
      "row-transport-ob",
      "input-transport-ic-rate",
      "input-transport-ob-rate",
      "input-transport-ic-min",
      "input-transport-ob-min",
      "label-transport-rate-unit-ic",
      "label-transport-min-unit-ob",
      "text-transport-formula",
      "button-transport-reset",
    ]) {
      expect(screen.getByTestId(id)).toBeInTheDocument();
    }
    expect(screen.getByTestId("label-transport-rate-unit-head").tagName).toBe("TH");
    expect(screen.queryByTestId("button-filter-menu-trigger")).toBeNull();
  });

  it("numbers are centred; header texts unchanged", () => {
    renderTab();
    const headers = within(screen.getByTestId("transport-costs-tab")).getAllByRole("columnheader");
    expect(headers.map(h => h.textContent)).toEqual(["Leg", "Rate ($/ton-mi)", "Min ($/ton)"]);
    expect(headers[1]).toHaveClass("text-center");
    expect(headers[2]).toHaveClass("text-center");
    expect(headers[0]).not.toHaveClass("text-center");
  });

  it("history read-only disables every field and Reset", () => {
    renderTab(true);
    for (const id of ["input-transport-ic-rate", "input-transport-ob-rate", "input-transport-ic-min", "input-transport-ob-min", "button-transport-reset"]) {
      expect(screen.getByTestId(id)).toBeDisabled();
    }
  });
});
SCU_EOF
```

- [ ] **Step 3: Run it to verify it fails**

Run: `pnpm --filter studio exec vitest run src/__tests__/TransportCostsTab.dataTable.test.tsx`
Expected: FAIL — `Tests  1 failed | 2 passed (3)` (measured at plan time against the pre-migration tab) — only the centring test fails: every testid already exists, the numeric headers are not `text-center` yet.

- [ ] **Step 4: Implement — `TransportCostsTab.tsx`**

Replace the whole file `artifacts/studio/src/components/workspace/tabs/TransportCostsTab.tsx` with:

```bash
mkdir -p artifacts/studio/src/components/workspace/tabs && cat > artifacts/studio/src/components/workspace/tabs/TransportCostsTab.tsx <<'SCU_EOF'
import { useEffect, useState } from "react";
import { roundForFile, type CanonicalUnit } from "@workspace/units";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/data-table/DataTable";
import type { ColumnDef } from "@/components/data-table/types";
import { useDisplayUnit } from "@/contexts/UnitContext";
import { useDistanceDraft, type DraftConversion } from "@/hooks/useDistanceDraft";
import { stripGrouping } from "@/lib/formatDistanceDisplay";
import {
  IDENTITY_CONVERSION,
  UI_MIN_CHARGE_MAX,
  UI_RATE_MAX,
  rateConversion,
  rateUnitLabel,
  type TransportCosts,
} from "@/lib/transportCosts";

// ch9-tc — Chapter 9's four transportation cost parameters (spec §5.1).
// Four global scalars, not a lane grid: the per-lane $/ton is always
// DERIVED (JadeDistancesTab's two columns), never stored.
//
// Canonical storage is always $/ton-mile. The display toggle converts a
// RATE reciprocally (see lib/transportCosts.ts) and leaves a $/ton minimum
// charge alone — which is why the two field kinds pass different
// `convert` pairs into the one shared draft hook rather than this file
// re-implementing the draft state machine.

interface TransportCostsTabProps {
  canonicalUnit: CanonicalUnit | null;
  /** Effective values — the scenario's own, or the textbook defaults. */
  transportCosts: TransportCosts;
  /** True when the scenario actually carries rates (enables Reset). */
  isCustom: boolean;
  /** Always called with ALL FOUR fields (the schema is all-or-nothing). */
  onChange(next: TransportCosts): void;
  /** Clears the key entirely — never writes the textbook literals, so a
   *  reset scenario is indistinguishable from one never edited. */
  onReset(): void;
  /** True while the result-history stepper is parked on a non-latest entry.
   *  Workspace's `updateInputsField` guard is the real write barrier; this
   *  is the visible half of the same rule. */
  disabled?: boolean;
  scenarioId?: number;
}

function TransportCostField({
  canonicalUnit,
  value,
  max,
  convert,
  disabled,
  resetKey,
  onCommitValid,
  inputTestId,
  errorTestId,
  label,
}: {
  canonicalUnit: CanonicalUnit | null;
  value: number;
  max: number;
  convert: DraftConversion;
  disabled: boolean;
  resetKey: unknown;
  onCommitValid: (canonicalValue: number) => void;
  inputTestId: string;
  errorTestId: string;
  label: string;
}) {
  const [rejected, setRejected] = useState<string | null>(null);
  useEffect(() => setRejected(null), [resetKey, value]);
  const draft = useDistanceDraft({
    canonicalUnit,
    value,
    convert,
    resetKey,
    onCommit: v => {
      // Domain validation lives HERE, not in the hook: the hook commits any
      // grammar-complete draft, and ten existing call sites share it.
      if (!Number.isFinite(v) || v < 0) {
        setRejected("Must be a number of 0 or more.");
        return;
      }
      // The committed value is canonical, so this is the authoritative
      // server-equivalent bound check even when the field displays km.
      if (v > max) {
        setRejected(`Must be ${max.toLocaleString()} or less.`);
        return;
      }
      setRejected(null);
      onCommitValid(v);
    },
  });

  // Live, as-you-type validation, independent of the commit grammar (same
  // pattern as JadeDistancesTab's own override cell).
  const trimmed = stripGrouping(draft.text).trim();
  const numeric = trimmed === "" ? null : Number(trimmed);
  const displayMax = canonicalUnit == null ? null : roundForFile(convert.toDisplay(max, canonicalUnit));
  const liveError =
    trimmed === "" || numeric === null || Number.isNaN(numeric)
      ? trimmed === ""
        ? null
        : "Must be a number."
      : numeric < 0
        ? "Must be 0 or more."
        : displayMax != null && numeric > displayMax
          ? // `displayMax` is already rounded to the field's 4 dp via
            // `roundForFile`; `toLocaleString()` would re-round it to its
            // default 3 fraction digits (6.2137 -> "6.214"), silently
            // misstating the actual live-validation boundary.
            `Must be ${displayMax} or less.`
          : null;
  const error = liveError ?? rejected;

  return (
    <div className="flex flex-col gap-0.5">
      <Input
        type="text"
        inputMode="decimal"
        aria-label={label}
        value={draft.text}
        disabled={disabled || draft.disabled}
        onChange={e => {
          setRejected(null);
          draft.onChange(e.target.value);
        }}
        onBlur={draft.commit}
        onKeyDown={e => {
          if (e.key === "Enter") draft.commit();
          else if (e.key === "Escape") draft.discard();
        }}
        className="h-8 w-full min-w-28 text-sm font-mono"
        data-testid={inputTestId}
      />
      {error && (
        <span className="text-[10px] text-destructive" data-testid={errorTestId}>
          {error}
        </span>
      )}
    </div>
  );
}

export function TransportCostsTab({
  canonicalUnit,
  transportCosts,
  isCustom,
  onChange,
  onReset,
  disabled = false,
  scenarioId,
}: TransportCostsTabProps) {
  const unit = useDisplayUnit();
  const rateConvert = rateConversion(unit);
  const rateLabel = rateUnitLabel(canonicalUnit, unit);

  /**
   * The semantic no-op guard (spec §2.4), in DISPLAY space at the same 4 dp
   * the field renders. A same-unit equivalent spelling ("0.0700") is already
   * bit-identical through `fromDisplay`, but a cross-unit round trip lands on
   * 0.069999…/0.070006…, and only the display-space comparison sees that as
   * unchanged. Raw string comparison is forbidden — "0.0700" and "0.07" are
   * the same value and must not stale the scenario.
   *
   * WF-6 correction: this comment used to say the guard lives here "not in
   * the hook", because moving it inside would change behaviour for every
   * caller. WF-6 did exactly that — `useDistanceDraft.commit()` now carries
   * its own no-op guard, so all 15 call sites inherit one. This guard is
   * therefore reached only after the hook's has already passed, and the two
   * stack as an AND of two independent no-op detectors.
   *
   * It is kept because it is NOT equivalent to the hook's, despite looking
   * like it. The hook compares `roundForFile` of two CANONICAL values (1e-4
   * canonical); this compares `roundForFile` of two DISPLAY values, and for a
   * rate `toDisplay` DIVIDES by the unit factor, so 1e-4 in display space is
   * ~1.6e-4 in canonical space. This guard is strictly the coarser of the two
   * for the rate fields and suppresses commits the hook's would let through.
   * Deleting it would widen what counts as a change — a behaviour change, not
   * a cleanup. (For the min-charge fields, which pass `IDENTITY_CONVERSION`,
   * the two guards genuinely do coincide.)
   */
  function commitField(field: keyof TransportCosts, incoming: number, convert: DraftConversion) {
    if (canonicalUnit != null) {
      const stored = transportCosts[field];
      if (roundForFile(convert.toDisplay(incoming, canonicalUnit)) === roundForFile(convert.toDisplay(stored, canonicalUnit))) {
        return;
      }
    }
    onChange({ ...transportCosts, [field]: incoming });
  }

  type Leg = {
    key: "ic" | "ob";
    label: string;
    lane: string;
    rateField: "icTransCost" | "obTransCost";
    minField: "icMinTrans" | "obMinTrans";
  };
  const legs: Leg[] = [
    { key: "ic", label: "Inbound", lane: "plant → warehouse", rateField: "icTransCost", minField: "icMinTrans" },
    { key: "ob", label: "Outbound", lane: "warehouse → customer", rateField: "obTransCost", minField: "obMinTrans" },
  ];

  // SCU-2.P4.8 (B2.1) — the two fixed rows render through the shared
  // DataTable (no filter or pager at 2 rows; numbers centred). No Upload /
  // Download (spec scope). History read-only was already wired (`disabled`).
  const columns: ColumnDef<Leg>[] = [
    {
      id: "leg",
      header: "Leg",
      kind: "text",
      value: leg => leg.label,
      cellClassName: "text-xs",
      cell: leg => (
        <>
          <div className="font-medium">{leg.label}</div>
          <div className="text-muted-foreground">{leg.lane}</div>
        </>
      ),
    },
    {
      id: "rate",
      header: `Rate${rateLabel ? ` (${rateLabel})` : ""}`,
      headerTestId: "label-transport-rate-unit-head",
      kind: "number",
      value: leg => transportCosts[leg.rateField],
      cell: leg => (
        <>
          <TransportCostField
            canonicalUnit={canonicalUnit}
            value={transportCosts[leg.rateField]}
            max={UI_RATE_MAX}
            convert={rateConvert}
            disabled={disabled}
            resetKey={scenarioId}
            onCommitValid={v => commitField(leg.rateField, v, rateConvert)}
            inputTestId={`input-transport-${leg.key}-rate`}
            errorTestId={`error-transport-${leg.key}-rate`}
            label={`${leg.label} rate`}
          />
          <span className="text-[10px] text-muted-foreground" data-testid={`label-transport-rate-unit-${leg.key}`}>
            {rateLabel ?? "—"}
          </span>
        </>
      ),
    },
    {
      id: "min",
      header: "Min ($/ton)",
      kind: "number",
      value: leg => transportCosts[leg.minField],
      cell: leg => (
        <>
          <TransportCostField
            canonicalUnit={canonicalUnit}
            value={transportCosts[leg.minField]}
            max={UI_MIN_CHARGE_MAX}
            convert={IDENTITY_CONVERSION}
            disabled={disabled}
            resetKey={scenarioId}
            onCommitValid={v => commitField(leg.minField, v, IDENTITY_CONVERSION)}
            inputTestId={`input-transport-${leg.key}-min`}
            errorTestId={`error-transport-${leg.key}-min`}
            label={`${leg.label} minimum charge`}
          />
          <span className="text-[10px] text-muted-foreground" data-testid={`label-transport-min-unit-${leg.key}`}>
            $/ton
          </span>
        </>
      ),
    },
  ];

  return (
    <div className="p-4 space-y-3" data-testid="transport-costs-tab">
      <DataTable<Leg>
        rows={legs}
        rowKey={leg => leg.key}
        columns={columns}
        ctx={{ readOnly: disabled, demandEditable: false }}
        testIds={{ row: leg => `row-transport-${leg.key}` }}
      />

      <p className="text-xs text-muted-foreground" data-testid="text-transport-formula">
        cost per ton = max(rate × distance, min)
      </p>

      <Button
        size="sm"
        variant="outline"
        className="h-7 px-2 text-xs"
        disabled={disabled || !isCustom}
        onClick={onReset}
        data-testid="button-transport-reset"
      >
        Reset to textbook values
      </Button>
    </div>
  );
}
SCU_EOF
```

- [ ] **Step 5: Run the task's tests**

Run: `pnpm --filter studio exec vitest run src/__tests__/TransportCostsTab.dataTable.test.tsx src/__tests__/historyReadOnlyTabs.test.ts src/__tests__/TransportCostsTab.test.tsx`
Expected: PASS — 16 tests in 2 files (measured at plan time), plus `TransportCostsTab.test.tsx` unchanged (19 tests). Then `pnpm --filter studio typecheck` → exit 0.

- [ ] **Step 6: e2e sweep, rewrites and local run**

Sweep (matrix §3 prefixes for this instance; `labs.spec.ts` excluded):
```bash
grep -rn -E 'transport-costs-tab|input-transport-|label-transport-|button-transport-reset' artifacts/studio/e2e --include='*.ts' | grep -v labs.spec.ts
```
No rewrite needed — every id is emitted unchanged.

Then `pnpm --filter studio typecheck:e2e` (exit 0) and, with both local servers up (Global Constraints), run
```bash
cd artifacts/studio && E2E_BASE_URL=http://localhost:5179 npx playwright test e2e/jade-transport-costs.spec.ts
```
Expected: every test passes (a failure → flake registry by test name, two isolated re-runs, before calling it a regression). Record per-spec pass/fail in the changelog entry.

- [ ] **Step 7: Gate**

Run each separately (Global Constraints):
1. `cnt=$(ps aux | grep "[v]itest" | grep -v "zsh -c" | wc -l | tr -d ' '); [ "$cnt" = "0" ]`
2. `pnpm run typecheck`
3. `pnpm --filter studio typecheck:e2e`
4. `DATABASE_URL="postgresql://shubhamkr@localhost:5432/nos_dev" pnpm --filter api-server test`
5. `pnpm --filter studio test`
6. `(cd artifacts/api-server/src/solver && python3 -m pytest tests/ -x)`
7. `pnpm --filter @workspace/import-schema test`

Expected: every command exits 0. Then `git diff --stat "$P3_TIP"..HEAD -- artifacts/api-server lib/db lib/api-spec` prints nothing.

- [ ] **Step 8: Changelog**

Append to the bottom of `docs/CHANGELOG-implementation.md`:

```markdown

### SCU-2.P4.8 — JADE Transport Costs on DataTable

- `TransportCostsTab` on DataTable (2 fixed rows, header testid via `headerTestId`, numbers centred). No Upload/Download (spec). History read-only unchanged (`disabled`).
- Deviation 3.
- Gate: studio <N passed>, api-server <N passed>, pytest <N passed>, import-schema <N passed>. e2e (local, `E2E_BASE_URL` set): <spec: pass/fail per spec>.
```

Replace each `<…>` with the value measured in this run, or the literal `unknown`.

- [ ] **Step 9: Commit**

```bash
git add artifacts/studio/src/__tests__/TransportCostsTab.dataTable.test.tsx
```

```bash
[ "$(git rev-parse --abbrev-ref HEAD)" != "main" ] || exit 1
```

```bash
git commit artifacts/studio/src/__tests__/TransportCostsTab.dataTable.test.tsx artifacts/studio/src/components/workspace/tabs/TransportCostsTab.tsx docs/CHANGELOG-implementation.md -m "[SCU-2.P4.8] render JADE Transport Costs through DataTable" -m "Two fixed rows through the shared shell; numbers centred; no upload/download (spec scope). Deviation 3." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task SCU-2.P4.9: Plant Capability Matrix on DataTable (no Upload/Download)

**Owner role:** frontend-engineer. **Matrix:** §1 #16, §2b CapabilityMatrix. **Spec:** B2.1, B2.2, D2; B2.3/B2.4 exclusion. **Deviations:** 3, 15, 17.

**Files:**
- Create: `artifacts/studio/src/__tests__/CapabilityMatrixTab.dataTable.test.tsx`
- Modify: `artifacts/studio/src/components/workspace/tabs/CapabilityMatrixTab.tsx`
- Modify: `artifacts/studio/src/pages/Workspace.tsx`
- Modify: `artifacts/studio/src/__tests__/historyReadOnlyTabs.test.ts`
- Modify: `docs/CHANGELOG-implementation.md` (append `### SCU-2.P4.9`)

**Interfaces:**
- Consumes: `DataTable`, `ColumnDef` (`hidden`, `cellTestId`), `testIds.count`, `toolbar.extra`, `noMatchText` (P1).
- Produces: `CapabilityMatrixTab` prop `readOnly?: boolean`.

**Behaviour changes (record each in the changelog):**
- History read-only on every checkbox (D2 — never disabled before).
- The capacity label moves into the DataTable toolbar (left), the always-on count stays right of it; FilterMenu (> 10 plants) keeps `plant` text + filter-only `state` select. No Upload/Download (spec).

- [ ] **Step 0: Invoke the simplicity skills**

Skill tool: `andrej-karpathy-skills:karpathy-guidelines`, then `ponytail:ponytail`. Record in the report that both ran (hard rule #12).

- [ ] **Step 1: Preconditions**

Run each line alone (worktree root):
```bash
cd /Users/shubhamkr/nos-scu-2.p4.9 && git rev-parse --abbrev-ref HEAD
git merge-base --is-ancestor "$BASE" HEAD || exit 1
git merge-base --is-ancestor "$B1_TIP" HEAD || exit 1
git merge-base --is-ancestor "$P3_TIP" HEAD || exit 1
test -f artifacts/studio/src/components/data-table/DataTable.tsx && test -f artifacts/studio/src/components/data-table/DownloadMenu.tsx && test -d lib/import-schema || exit 1
pnpm install --frozen-lockfile
```
Then confirm the files this task replaces wholesale are still the `46d2f98` text (Global Constraints):
```bash
git diff --quiet 46d2f98 HEAD -- artifacts/studio/src/components/workspace/tabs/CapabilityMatrixTab.tsx || { echo 'STOP: artifacts/studio/src/components/workspace/tabs/CapabilityMatrixTab.tsx changed since 46d2f98'; exit 1; }
```

- [ ] **Step 2: Write the failing test**

Create `artifacts/studio/src/__tests__/CapabilityMatrixTab.dataTable.test.tsx`:

```bash
mkdir -p artifacts/studio/src/__tests__ && cat > artifacts/studio/src/__tests__/CapabilityMatrixTab.dataTable.test.tsx <<'SCU_EOF'
// SCU-2.P4.9 — the Plant Capability Matrix on the shared DataTable (B2.1/B2.2,
// D2). No Upload / Download (spec scope). Pins the matrix testids (incl. the
// <td> plant testid with no wrapper, and the always-on count), the kept
// `plant` text + filter-only `state` select above 10 plants, history
// read-only on every checkbox, and one toggle round-trip.

import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { CapabilityMatrixTab, type CapabilityOverride } from "@/components/workspace/tabs/CapabilityMatrixTab";

const products = [
  { id: "product-1", name: "Copper" },
  { id: "product-2", name: "Aluminum" },
];
const plants = Array.from({ length: 11 }, (_, i) => ({
  id: `plant-${i + 1}`,
  name: `Plant ${i + 1}`,
  city: `City ${i + 1}`,
  state: i === 10 ? "KY" : "OH",
  lat: 1,
  lng: 1,
}));
const baseCapabilities = plants.flatMap(p => products.map(pr => ({ plantId: p.id, productId: pr.id, capacity: pr.id === "product-1" ? 1000 : 0 })));

const renderTab = (props: Partial<React.ComponentProps<typeof CapabilityMatrixTab>> = {}) =>
  render(<CapabilityMatrixTab plants={plants} products={products} baseCapabilities={baseCapabilities} overrides={[]} onChange={vi.fn()} {...props} />);

describe("CapabilityMatrixTab on DataTable (SCU-2.P4.9)", () => {
  it("emits every testid in the matrix map", () => {
    renderTab();
    for (const id of [
      "capability-matrix-tab",
      "text-capability-capacity-label",
      "text-capability-count",
      "button-filter-menu-trigger",
      "row-capability-plant-1",
      "text-capability-plant-plant-1",
      "checkbox-capability-plant-1-product-1",
      "text-capability-capacity-plant-1-product-1",
    ]) {
      expect(screen.getByTestId(id)).toBeInTheDocument();
    }
    expect(screen.getByTestId("text-capability-count")).toHaveTextContent("11 of 11");
    const plantCell = screen.getByTestId("text-capability-plant-plant-1");
    expect(plantCell.tagName).toBe("TD");
    // e2e (workspace-fixups.spec.ts) counts the EntityIdCell's two spans inside the <td>.
    expect(plantCell.querySelectorAll(":scope > div > span")).toHaveLength(2);
    expect(within(screen.getByTestId("capability-matrix-tab")).getAllByRole("columnheader").map(h => h.textContent)).toEqual([
      "Plant",
      "Copper",
      "Aluminum",
    ]);
  });

  it("keeps the plant text filter and the filter-only state select (no rendered State column)", () => {
    renderTab();
    fireEvent.click(screen.getByTestId("button-filter-menu-trigger"));
    expect(screen.getByTestId("input-filter-plant")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("checkbox-filter-state-KY"));
    expect(screen.getByTestId("text-capability-count")).toHaveTextContent("1 of 11");
    expect(screen.getByTestId("row-capability-plant-11")).toBeInTheDocument();
    expect(screen.queryByTestId("row-capability-plant-1")).toBeNull();
    expect(screen.queryByTestId("filter-control-product:product-1")).toBeNull();
  });

  it("the no-match text is the matrix's own", () => {
    renderTab();
    fireEvent.click(screen.getByTestId("button-filter-menu-trigger"));
    fireEvent.change(screen.getByTestId("input-filter-plant"), { target: { value: "zzz" } });
    expect(screen.getByText("No plants match the current filter.")).toBeInTheDocument();
  });

  it("no filter menu at ≤ 10 plants (JADE ships 4)", () => {
    renderTab({ plants: plants.slice(0, 4) });
    expect(screen.queryByTestId("button-filter-menu-trigger")).toBeNull();
    expect(screen.getByTestId("text-capability-count")).toHaveTextContent("4 of 4");
  });

  it("history read-only (D2): every checkbox is disabled", () => {
    renderTab({ readOnly: true });
    for (const p of plants) for (const pr of products) expect(screen.getByTestId(`checkbox-capability-${p.id}-${pr.id}`)).toBeDisabled();
  });

  it("toggle round-trip through a stateful parent", () => {
    function Parent() {
      const [o, setO] = useState<CapabilityOverride[]>([]);
      return <CapabilityMatrixTab plants={plants.slice(0, 2)} products={products} baseCapabilities={baseCapabilities} overrides={o} onChange={setO} />;
    }
    render(<Parent />);
    const box = screen.getByTestId("checkbox-capability-plant-1-product-2");
    expect(box).toHaveAttribute("aria-checked", "false");
    fireEvent.click(box);
    expect(screen.getByTestId("checkbox-capability-plant-1-product-2")).toHaveAttribute("aria-checked", "true");
  });
});
SCU_EOF
```

- [ ] **Step 3: Run it to verify it fails**

Run: `pnpm --filter studio exec vitest run src/__tests__/CapabilityMatrixTab.dataTable.test.tsx`
Expected: FAIL — `Tests  1 failed | 5 passed (6)` (measured at plan time against the pre-migration tab) — only the history test fails: the checkboxes are never disabled today (and `readOnly` is not yet a prop).

- [ ] **Step 4: Implement — `CapabilityMatrixTab.tsx`**

Replace the whole file `artifacts/studio/src/components/workspace/tabs/CapabilityMatrixTab.tsx` with:

```bash
mkdir -p artifacts/studio/src/components/workspace/tabs && cat > artifacts/studio/src/components/workspace/tabs/CapabilityMatrixTab.tsx <<'SCU_EOF'
import type { Plant, Product, PlantProductCapability } from "@workspace/api-client-react";
import { Checkbox } from "@/components/ui/checkbox";
import { DataTable } from "@/components/data-table/DataTable";
import type { ColumnDef } from "@/components/data-table/types";
import { isCellEnabled, cellCapacity, type CapabilityOverride } from "@/lib/jadeCapability";
import { EntityIdCell } from "@/components/tables/EntityIdCell";

// T11 (Chapter 9 JADE) — matches `jadeInputsSchema`'s
// `plantProductCapability[]` shape exactly (`{plantId, productId, enabled}`,
// pair-unique). A sparse override array over the base 16-cell matrix
// (`Dataset.plantProductCapabilities`).
//
// B5 (JADE Ch.9 Workspace Bundle, spec §7) — re-exported from
// `lib/jadeCapability.ts` (A2), which is now the single source of truth for
// this shape and the enabled/capacity math (`isCellEnabled`/`cellCapacity`).
// Re-exported (not re-declared) so existing consumers
// (`InputMapTab.tsx`/`Workspace.tsx`) that import `CapabilityOverride` from
// THIS file keep working unchanged.
export type { CapabilityOverride };

interface CapabilityMatrixTabProps {
  /** Effective plants — base ∪ added, projection built by Workspace.tsx
   * (T15.5, spec §6/Gate 6.5's "effective-row projection"). This component
   * only renders whatever rows it's given; it doesn't know or care whether
   * a row is a base or an added plant. */
  plants: Plant[];
  products: Product[];
  /** Base 16-cell matrix (`Dataset.plantProductCapabilities`). A cell with
   * `capacity > 0` is enabled by default; a missing cell (e.g. every cell
   * for an added plant, which never has a base-matrix entry) defaults to
   * disabled — matches spec §6: "base rows default from the 16-cell
   * matrix and added-plant rows default off." */
  baseCapabilities: PlantProductCapability[];
  /** Sparse scenario-local overrides. */
  overrides: CapabilityOverride[];
  onChange: (next: CapabilityOverride[]) => void;
  /** JADE-only — id -> {city, state}, built by Workspace.tsx's
   * `jadeLocationMapFromInputs`. Used by `buildFilterDescriptors` below to
   * widen the filter search text, and (T11, compatibility resolver) as a
   * fallback location source for the row header when `identityById` is
   * unset. */
  locationById?: Record<string, { city: string; state: string }>;
  /** T11 (workspace-fixups-2, item 2 — "CapabilityMatrix aligns to
   * EntityIdCell") — canonical id -> {city, state, displayId} (base dataset
   * ∪ scenario-local addedPlants), built by Workspace.tsx's
   * `buildEntityIdentityById(modelId, dataset, localInputs)` (the LIVE
   * draft — this is an INPUT tab). The per-plant row header now renders via
   * the shared `EntityIdCell` (stacked City/State + mono display-id,
   * matching Open WHs) instead of the old single-line `plantIdCityState`
   * format. COMPATIBILITY RESOLVER: prefer this map's entry, else fall back
   * to `locationById`/the `plants` prop's own city/state (and the raw
   * canonical id for displayId — `plant.name` is still never shown, matching
   * the pre-existing contract) — unset is the SAME underlying data as
   * before, just rendered in the new stacked shape. */
  identityById?: Record<string, { city: string; state: string; displayId: string }>;
  /** SCU-2.P4.9 (D2) — browsing result history: every checkbox is disabled. */
  readOnly?: boolean;
}

// B5 — a plant row (not a product column) is this table's filterable unit
// (spec §10: "the Capability Matrix's 16 *cells* render as 4 plant *rows*").
// A single text descriptor covers name/id/city/state via one combined
// search string (mirrors JadeDistancesTab's own `searchText` helper), plus
// a select descriptor on State for a quick narrow-down.
const READ_ONLY_TITLE = "Read-only while browsing result history.";

// SCU-2.P4.9 (B2.1/B2.2) — the plants × products pivot on the shared
// DataTable. The plant search text and the filter-only `state` select are
// kept exactly (column ids `plant` / `state`, so `input-filter-plant` /
// `select-filter-state` survive); product columns are not filterable. No
// Upload / Download (spec scope). History read-only (D2) is new.
export function CapabilityMatrixTab({
  plants,
  products,
  baseCapabilities,
  overrides,
  onChange,
  locationById,
  identityById,
  readOnly = false,
}: CapabilityMatrixTabProps) {
  function resolvedPlantLocation(plant: Plant): { city: string; state: string } {
    const entry = identityById?.[plant.id];
    if (entry && (entry.city || entry.state)) return { city: entry.city, state: entry.state };
    return { city: plant.city, state: plant.state };
  }
  function resolvedPlantDisplayId(plant: Plant): string {
    return identityById?.[plant.id]?.displayId ?? plant.id;
  }

  function effectiveEnabled(plantId: string, productId: string): boolean {
    return isCellEnabled(baseCapabilities, overrides, plantId, productId);
  }

  function toggle(plantId: string, productId: string) {
    const current = effectiveEnabled(plantId, productId);
    const next = !current;
    const base = isCellEnabled(baseCapabilities, [], plantId, productId);
    const rest = overrides.filter(o => !(o.plantId === plantId && o.productId === productId));
    onChange(next === base ? rest : [...rest, { plantId, productId, enabled: next }]);
  }

  if (plants.length === 0 || products.length === 0) {
    return (
      <p className="text-sm text-muted-foreground" data-testid="capability-matrix-empty">
        No plants or products in this dataset.
      </p>
    );
  }

  // Rebuilt every render: cells close over live props (see DistancesTab).
  const columns: ColumnDef<Plant>[] = [
    {
      id: "plant",
      header: "Plant",
      kind: "text",
      filter: "text",
      value: plant => {
        const loc = locationById?.[plant.id];
        return [plant.name ?? plant.id, plant.id, loc?.city ?? plant.city, loc?.state ?? plant.state].filter(Boolean).join(" ");
      },
      cellClassName: "text-xs",
      cellTestId: plant => `text-capability-plant-${plant.id}`,
      cell: plant => (
        <EntityIdCell entityId={plant.id} displayId={resolvedPlantDisplayId(plant)} location={resolvedPlantLocation(plant)} />
      ),
    },
    {
      id: "state",
      header: "State",
      hidden: true,
      kind: "text",
      filter: "select",
      value: plant => locationById?.[plant.id]?.state ?? plant.state,
      cell: () => null,
    },
    ...products.map(
      (product): ColumnDef<Plant> => ({
        id: `product:${product.id}`,
        header: product.name,
        kind: "enum",
        filter: false,
        value: plant => (effectiveEnabled(plant.id, product.id) ? "enabled" : "disabled"),
        cell: plant => {
          const checked = effectiveEnabled(plant.id, product.id);
          const capacity = cellCapacity(baseCapabilities, plant.id, product.id, checked);
          return (
            <div className="flex flex-col items-start gap-0.5">
              <Checkbox
                checked={checked}
                onCheckedChange={() => toggle(plant.id, product.id)}
                disabled={readOnly}
                title={readOnly ? READ_ONLY_TITLE : undefined}
                data-testid={`checkbox-capability-${plant.id}-${product.id}`}
                aria-label={`${plant.name ?? plant.id} can make ${product.name}`}
              />
              <span
                className="font-mono text-[10px] text-muted-foreground"
                data-testid={`text-capability-capacity-${plant.id}-${product.id}`}
              >
                {capacity.toLocaleString()} Units
              </span>
            </div>
          );
        },
      }),
    ),
  ];

  return (
    <div data-testid="capability-matrix-tab">
      <DataTable<Plant>
        rows={plants}
        rowKey={plant => plant.id}
        columns={columns}
        ctx={{ readOnly, demandEditable: false }}
        testIds={{ row: plant => `row-capability-${plant.id}`, count: "text-capability-count" }}
        toolbar={{
          extra: (
            <p className="text-xs text-muted-foreground md:whitespace-nowrap" data-testid="text-capability-capacity-label">
              Capacity shown below each checkbox is the capacity per plant-product combination — not the plant's total capacity.
            </p>
          ),
        }}
        scrollClassName="max-h-[60vh] overflow-y-auto"
        noMatchText="No plants match the current filter."
      />
    </div>
  );
}
SCU_EOF
```

- [ ] **Step 5: Wire Workspace, flip the D2 guard, rewrite the by-design test breaks**

Adds `readOnly={isBrowsingHistoryNow}` to the `<CapabilityMatrixTab` mount and flips the guard:

```bash
python3 - <<'PY'
import pathlib
EDITS = [
    ('artifacts/studio/src/pages/Workspace.tsx',
     '''        <CapabilityMatrixTab
''',
     '''        <CapabilityMatrixTab
          readOnly={isBrowsingHistoryNow}
'''),
    ('artifacts/studio/src/__tests__/historyReadOnlyTabs.test.ts',
     '''  CapabilityMatrixTab: "pending", // SCU-2.P4.9''',
     '''  CapabilityMatrixTab: "readOnly", // SCU-2.P4.9'''),
]
for path, old, new in EDITS:
    f = pathlib.Path(path)
    s = f.read_text()
    n = s.count(old)
    if n != 1:
        raise SystemExit(f'STOP: {path}: anchor found {n} times (expected 1): {old[:80]!r}')
    f.write_text(s.replace(old, new, 1))
print(f'applied {len(EDITS)} edits')
PY
```

- [ ] **Step 6: Run the task's tests**

Run: `pnpm --filter studio exec vitest run src/__tests__/CapabilityMatrixTab.dataTable.test.tsx src/__tests__/historyReadOnlyTabs.test.ts src/__tests__/CapabilityMatrixTab.test.tsx`
Expected: PASS — 19 tests in 2 files (measured at plan time), plus `CapabilityMatrixTab.test.tsx` unchanged (22 tests). Then `pnpm --filter studio typecheck` → exit 0.

- [ ] **Step 7: e2e sweep, rewrites and local run**

Sweep (matrix §3 prefixes for this instance; `labs.spec.ts` excluded):
```bash
grep -rn -E 'capability-matrix-|checkbox-capability-|text-capability-|row-capability-' artifacts/studio/e2e --include='*.ts' | grep -v labs.spec.ts
```
No rewrite needed: ids unchanged; `text-capability-plant-{id}` still a `<td>` with EntityIdCell's two spans directly inside (pinned in the new test); 4 JADE plants → no FilterMenu (`jade-ch9-workspace-bundle.spec.ts` asserts count 0); `text-capability-capacity-label` keeps `md:whitespace-nowrap` (its height < 24 assert).

Then `pnpm --filter studio typecheck:e2e` (exit 0) and, with both local servers up (Global Constraints), run
```bash
cd artifacts/studio && E2E_BASE_URL=http://localhost:5179 npx playwright test e2e/jade-ch9-workspace-bundle.spec.ts e2e/jade-two-echelon.spec.ts e2e/workspace-fixups.spec.ts
```
Expected: every test passes (a failure → flake registry by test name, two isolated re-runs, before calling it a regression). Record per-spec pass/fail in the changelog entry.

- [ ] **Step 8: Gate**

Run each separately (Global Constraints):
1. `cnt=$(ps aux | grep "[v]itest" | grep -v "zsh -c" | wc -l | tr -d ' '); [ "$cnt" = "0" ]`
2. `pnpm run typecheck`
3. `pnpm --filter studio typecheck:e2e`
4. `DATABASE_URL="postgresql://shubhamkr@localhost:5432/nos_dev" pnpm --filter api-server test`
5. `pnpm --filter studio test`
6. `(cd artifacts/api-server/src/solver && python3 -m pytest tests/ -x)`
7. `pnpm --filter @workspace/import-schema test`

Expected: every command exits 0. Then `git diff --stat "$P3_TIP"..HEAD -- artifacts/api-server lib/db lib/api-spec` prints nothing.

- [ ] **Step 9: Changelog**

Append to the bottom of `docs/CHANGELOG-implementation.md`:

```markdown

### SCU-2.P4.9 — Plant Capability Matrix on DataTable

- `CapabilityMatrixTab` on DataTable: plant text + filter-only state select kept, count via `testIds.count`, capacity label in `toolbar.extra`, history read-only on checkboxes (D2, new).
- Deviations 3, 15, 17.
- Gate: studio <N passed>, api-server <N passed>, pytest <N passed>, import-schema <N passed>. e2e (local, `E2E_BASE_URL` set): <spec: pass/fail per spec>.
```

Replace each `<…>` with the value measured in this run, or the literal `unknown`.

- [ ] **Step 10: Commit**

```bash
git add artifacts/studio/src/__tests__/CapabilityMatrixTab.dataTable.test.tsx
```

```bash
[ "$(git rev-parse --abbrev-ref HEAD)" != "main" ] || exit 1
```

```bash
git commit artifacts/studio/src/__tests__/CapabilityMatrixTab.dataTable.test.tsx artifacts/studio/src/components/workspace/tabs/CapabilityMatrixTab.tsx artifacts/studio/src/pages/Workspace.tsx artifacts/studio/src/__tests__/historyReadOnlyTabs.test.ts docs/CHANGELOG-implementation.md -m "[SCU-2.P4.9] move the Plant Capability Matrix onto DataTable" -m "Pivot through the shared shell; plant/state filters kept; D2 read-only checkboxes; no upload/download (spec scope). Deviations 3, 15, 17." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task SCU-2.P4.10: Warehouses + Refineries on DataTable with the +Add modal

**Owner role:** frontend-engineer. **Matrix:** §1 #17–#20, §2c Warehouses/Refineries base + added. **Spec:** B2.1–B2.4, B2.8, D2, D4. **Deviations:** 1, 3, 9, 13, 14, 15, 17, 18.

**Files:**
- Create: `artifacts/studio/src/components/data-table/entityCells.tsx`
- Create: `artifacts/studio/src/__tests__/WarehousesTab.dataTable.test.tsx`
- Modify: `artifacts/studio/src/components/workspace/tabs/WarehousesTab.tsx`
- Modify: `artifacts/studio/src/__tests__/WarehousesTab.test.tsx`
- Modify: `artifacts/studio/src/__tests__/Workspace.Analytics.test.tsx`
- Modify: `artifacts/studio/src/__tests__/Workspace.TwoEchelon.test.tsx`
- Modify: `artifacts/studio/src/__tests__/Workspace.test.tsx`
- Modify: `artifacts/studio/src/__tests__/Workspace.Brazil.test.tsx`
- Modify: `artifacts/studio/src/pages/Workspace.tsx`
- Modify: `artifacts/studio/e2e/workspace-fixups.spec.ts`
- Modify: `artifacts/studio/e2e/workspace-fixups-2.spec.ts`
- Modify: `artifacts/studio/e2e/jade-ch9-workspace-bundle.spec.ts`
- Modify: `docs/CHANGELOG-implementation.md` (append `### SCU-2.P4.10`)

**Interfaces:**
- Consumes: P1 `DataTable` sections; P4.1 `useEntityFileMenus`; P4.2 `CreateEntityDialog` table mode; `completenessCountForWarehouse`, `idCollisionMessageForWarehouse`, `warehouseStatusPresentation` (unchanged).
- Produces: `entityCells.tsx` (`READ_ONLY_TITLE`, `StatusToggle`, `DeleteRowButton`, `DraftNumberInput`); `WarehousesTab` prop `modelId?`; new pager ids `button-{warehouses|refineries}-prev/next`, `{entity}-page-indicator`.

**Behaviour changes (record each in the changelog):**
- FilterMenu on every model above 10 rows over base + added (was JADE-only and base-only) — `workspace-fixups-2.spec.ts` inverts (by design).
- "+ Add warehouse" / "+ Add refinery" (still `button-add-warehouse-row`, D4) in the toolbar, opens the modal (status radio; capacity only for `per_wh`; display code always derived).
- History read-only now also covers added capacity/status/delete and the add trigger (D2).
- Upload ▾ / Download ▾ with expected fields; pager above 50 rows; numbers centred; `{entity}-tab` root always rendered.

- [ ] **Step 0: Invoke the simplicity skills**

Skill tool: `andrej-karpathy-skills:karpathy-guidelines`, then `ponytail:ponytail`. Record in the report that both ran (hard rule #12).

- [ ] **Step 1: Preconditions**

Run each line alone (worktree root):
```bash
cd /Users/shubhamkr/nos-scu-2.p4.10 && git rev-parse --abbrev-ref HEAD
git merge-base --is-ancestor "$BASE" HEAD || exit 1
git merge-base --is-ancestor "$B1_TIP" HEAD || exit 1
git merge-base --is-ancestor "$P3_TIP" HEAD || exit 1
test -f artifacts/studio/src/components/data-table/DataTable.tsx && test -f artifacts/studio/src/components/data-table/DownloadMenu.tsx && test -d lib/import-schema || exit 1
pnpm install --frozen-lockfile
```
Then confirm the files this task replaces wholesale are still the `46d2f98` text (Global Constraints):
```bash
git diff --quiet 46d2f98 HEAD -- artifacts/studio/src/components/workspace/tabs/WarehousesTab.tsx || { echo 'STOP: artifacts/studio/src/components/workspace/tabs/WarehousesTab.tsx changed since 46d2f98'; exit 1; }
```

- [ ] **Step 2: Write the failing test**

Create `artifacts/studio/src/__tests__/WarehousesTab.dataTable.test.tsx`:

```bash
mkdir -p artifacts/studio/src/__tests__ && cat > artifacts/studio/src/__tests__/WarehousesTab.dataTable.test.tsx <<'SCU_EOF'
// SCU-2.P4.10 — Warehouses (and Refineries) on the shared DataTable (spec
// B2.1–B2.4, B2.8, D2, D4): base + added sections under one toolbar, ONE
// filter menu over both, history read-only on base AND added controls, the
// "+ Add warehouse" modal, and the refinery trigger keeping its warehouse id.

import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { AllProviders } from "@/__tests__/helpers/renderWithExportProvider";
import { WarehousesTab, type AddedWarehouse } from "@/components/workspace/tabs/WarehousesTab";
import type { WarehouseOverride } from "@/components/tables/WarehouseTable";

const base = Array.from({ length: 10 }, (_, i) => ({ id: `WH${i + 1}`, city: `City${i + 1}`, state: i < 5 ? "IL" : "OH", lat: 41 + i, lng: -87 - i }));
const added: AddedWarehouse[] = [{ id: "aw-1", city: "Denver", state: "CO", lat: 39.7, lng: -105, capacity: 500, status: "active", displayCode: "WH-CO-DENVER-01" }];

function renderTab(props: Partial<React.ComponentProps<typeof WarehousesTab>> = {}) {
  return render(
    <WarehousesTab
      warehouses={base}
      overrides={[{ id: "WH2", status: "forced_open" }]}
      capacityMode="per_wh"
      onChange={vi.fn()}
      scenarioId={1}
      addedWarehouses={added}
      onAddedWarehousesChange={vi.fn()}
      onDeleteWarehouse={vi.fn()}
      {...props}
    />,
    { wrapper: AllProviders },
  );
}

describe("WarehousesTab on DataTable (SCU-2.P4.10)", () => {
  it("emits every testid in the matrix map (base + added, toolbar, menus)", () => {
    renderTab();
    for (const id of [
      "warehouses-tab",
      "warehouses-tab-toolbar",
      "button-import-warehouses",
      "button-download-warehouses",
      "button-filter-menu-trigger",
      "button-add-warehouse-row",
      "input-wh-capacity-WH1",
      "button-wh-WH1-active",
      "button-wh-WH1-forced_open",
      "button-wh-WH1-inactive",
      "added-warehouses-section",
      "row-added-warehouse-aw-1",
      "input-added-wh-capacity-aw-1",
      "button-added-wh-aw-1-inactive",
      "button-delete-added-warehouse-aw-1",
    ]) {
      expect(screen.getByTestId(id)).toBeInTheDocument();
    }
    fireEvent.click(screen.getByTestId("button-download-warehouses"));
    expect(screen.getByTestId("button-export-warehouses-csv")).toBeInTheDocument();
    expect(screen.getByTestId("button-export-warehouses-json")).toBeInTheDocument();
  });

  it("base rows carry NO row testid; added rows do (matrix: base <tr> has none)", () => {
    renderTab();
    const baseRow = screen.getByTestId("input-wh-capacity-WH1").closest("tr")!;
    expect(baseRow).not.toHaveAttribute("data-testid");
    expect(screen.getByTestId("row-added-warehouse-aw-1").tagName).toBe("TR");
  });

  it("ONE filter menu over base + added rows (11 rows ≥ threshold), status option = presentation label", () => {
    renderTab();
    expect(screen.getAllByTestId("button-filter-menu-trigger")).toHaveLength(1);
    fireEvent.click(screen.getByTestId("button-filter-menu-trigger"));
    expect(screen.getByTestId("text-filter-count")).toHaveTextContent("11 of 11");
    fireEvent.click(screen.getByTestId("checkbox-filter-status-Fixed-Open"));
    expect(screen.getByTestId("text-filter-count")).toHaveTextContent("1 of 11");
    expect(screen.getByTestId("button-wh-WH2-forced_open")).toBeInTheDocument();
    expect(screen.queryByTestId("row-added-warehouse-aw-1")).toBeNull();
    fireEvent.click(screen.getByTestId("button-clear-all-filters"));
    fireEvent.change(screen.getByTestId("input-filter-city"), { target: { value: "denver" } });
    expect(screen.getByTestId("row-added-warehouse-aw-1")).toBeInTheDocument();
    expect(screen.queryByTestId("button-wh-WH1-active")).toBeNull();
  });

  it("numbers centred (lat, lng, capacity); header texts unchanged; JADE-like capacityMode none drops Capacity", () => {
    const { unmount } = renderTab();
    const headers = screen.getAllByRole("columnheader").map(h => h.textContent);
    expect(headers.slice(0, 7)).toEqual(["ID", "City", "State", "Latitude", "Longitude", "Capacity", "Status"]);
    expect(screen.getAllByRole("columnheader")[3]).toHaveClass("text-center");
    unmount();
    renderTab({ capacityMode: "none" });
    expect(screen.getAllByRole("columnheader").map(h => h.textContent)).not.toContain("Capacity");
  });

  it("history read-only (D2): base AND added capacity, status, delete and the add trigger are disabled", () => {
    renderTab({ disabled: true });
    for (const id of [
      "input-wh-capacity-WH1",
      "button-wh-WH1-forced_open",
      "input-added-wh-capacity-aw-1",
      "button-added-wh-aw-1-forced_open",
      "button-delete-added-warehouse-aw-1",
      "button-add-warehouse-row",
    ]) {
      expect(screen.getByTestId(id)).toBeDisabled();
    }
  });

  it("no added section (and no add trigger) when the added capability is not wired (delivery)", () => {
    renderTab({ addedWarehouses: undefined, onAddedWarehousesChange: undefined, onDeleteWarehouse: undefined });
    expect(screen.queryByTestId("added-warehouses-section")).toBeNull();
    expect(screen.queryByTestId("button-add-warehouse-row")).toBeNull();
  });

  it("+ Add warehouse opens the modal; submit appends through onAddedWarehousesChange", () => {
    const onAdded = vi.fn();
    renderTab({ onAddedWarehousesChange: onAdded });
    fireEvent.click(screen.getByTestId("button-add-warehouse-row"));
    const dialog = screen.getByTestId("create-entity-dialog");
    fireEvent.change(within(dialog).getByTestId("create-entity-city"), { target: { value: "Akron" } });
    fireEvent.change(within(dialog).getByTestId("create-entity-state"), { target: { value: "OH" } });
    fireEvent.change(within(dialog).getByTestId("create-entity-lat"), { target: { value: "41.08" } });
    fireEvent.change(within(dialog).getByTestId("create-entity-lng"), { target: { value: "-81.52" } });
    fireEvent.change(within(dialog).getByTestId("create-entity-capacity"), { target: { value: "900" } });
    fireEvent.click(within(dialog).getByTestId("create-entity-submit"));
    expect(onAdded).toHaveBeenCalledTimes(1);
    const next = onAdded.mock.calls[0]![0] as AddedWarehouse[];
    expect(next).toHaveLength(2);
    expect(next[1]).toMatchObject({ city: "Akron", state: "OH", lat: 41.08, lng: -81.52, capacity: 900, status: "active", displayCode: "WH-OH-AKRON-01" });
    expect(screen.queryByTestId("create-entity-dialog")).toBeNull();
  });

  it("Refineries: trigger keeps button-add-warehouse-row (D4), label and modal say refinery, no capacity", () => {
    renderTab({ entity: "refineries", capacityMode: "none" });
    expect(screen.getByTestId("refineries-tab-toolbar")).toBeInTheDocument();
    expect(screen.getByTestId("button-add-warehouse-row")).toHaveTextContent("+ Add refinery");
    fireEvent.click(screen.getByTestId("button-add-warehouse-row"));
    expect(screen.getByTestId("create-entity-dialog")).toHaveTextContent("New refinery");
    expect(screen.queryByTestId("create-entity-capacity")).toBeNull();
  });

  it("edit round-trip: a base status click and an added capacity edit reach their parents", () => {
    function Parent() {
      const [o, setO] = useState<WarehouseOverride[]>([]);
      const [a, setA] = useState<AddedWarehouse[]>(added);
      return <WarehousesTab warehouses={base} overrides={o} capacityMode="per_wh" onChange={setO} addedWarehouses={a} onAddedWarehousesChange={setA} onDeleteWarehouse={vi.fn()} />;
    }
    render(<Parent />, { wrapper: AllProviders });
    fireEvent.click(screen.getByTestId("button-wh-WH3-inactive"));
    expect(screen.getByTestId("button-wh-WH3-inactive")).toHaveClass("bg-destructive");
    fireEvent.change(screen.getByTestId("input-added-wh-capacity-aw-1"), { target: { value: "750" } });
    expect(screen.getByTestId("input-added-wh-capacity-aw-1")).toHaveValue(750);
  });
});
SCU_EOF
```

- [ ] **Step 3: Run it to verify it fails**

Run: `pnpm --filter studio exec vitest run src/__tests__/WarehousesTab.dataTable.test.tsx`
Expected: FAIL — `Tests  6 failed | 3 passed (9)` (measured at plan time against the pre-migration tab) — `WarehousesTab.dataTable.test.tsx` fails — no shared filter over added rows, no modal (`create-entity-dialog`), added controls not disabled in history, no Download ▾ trigger.

- [ ] **Step 4: Implement — `entityCells.tsx`**

Create `artifacts/studio/src/components/data-table/entityCells.tsx` with:

```bash
mkdir -p artifacts/studio/src/components/data-table && cat > artifacts/studio/src/components/data-table/entityCells.tsx <<'SCU_EOF'
// SCU-2.P4.10 — small cell components shared by the migrated entity input
// tables (Warehouses/Refineries, Customers, Plants, Mines, Stations). Each one
// replaces a block that was copy-pasted per table; behaviour is unchanged
// except that every control now takes `disabled` (D2: history read-only on
// base AND added rows).

import { useState } from "react";
import { X } from "lucide-react";
import { Input } from "@/components/ui/input";

export const READ_ONLY_TITLE = "Read-only while browsing result history.";

/** The segmented status control (warehouses: Potential/Fixed-Open/Inactive; customers: Active/Excluded). */
export function StatusToggle<S extends string>({
  options,
  value,
  labelOf,
  activeClassOf,
  onChange,
  disabled,
  testIdOf,
}: {
  options: readonly S[];
  value: S;
  labelOf: (s: S) => string;
  /** Classes for the selected option (e.g. "bg-primary text-white"). */
  activeClassOf: (s: S) => string;
  onChange: (s: S) => void;
  disabled: boolean;
  testIdOf: (s: S) => string;
}) {
  return (
    <div className="flex rounded border border-border overflow-hidden text-[10px] w-fit mx-auto">
      {options.map(s => (
        <button
          key={s}
          type="button"
          data-testid={testIdOf(s)}
          onClick={() => onChange(s)}
          disabled={disabled}
          title={disabled ? READ_ONLY_TITLE : undefined}
          className={`px-2 py-1 transition-colors whitespace-nowrap ${
            value === s ? activeClassOf(s) : "bg-white text-muted-foreground hover:bg-muted"
          } ${disabled ? "opacity-50 cursor-not-allowed" : ""}`}
        >
          {labelOf(s)}
        </button>
      ))}
    </div>
  );
}

/** The trailing ✕ on an added row. */
export function DeleteRowButton({ label, onClick, disabled, testId }: { label: string; onClick: () => void; disabled: boolean; testId: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      title={disabled ? READ_ONLY_TITLE : undefined}
      data-testid={testId}
      className="text-muted-foreground hover:text-destructive disabled:opacity-50 disabled:cursor-not-allowed"
    >
      <X className="w-3.5 h-3.5" />
    </button>
  );
}

/** A capacity-style number input that commits on every keystroke (as the
 * WarehouseTable/MineTable inputs did) and keeps the raw keystroke text while
 * the committed value is what the parent now shows. An EXTERNAL change
 * (Discard, a history step, an import) drops the draft — the role of the old
 * per-table `lastCommittedRef` reconciliation. */
export function DraftNumberInput({
  value,
  parse,
  onCommit,
  disabled,
  placeholder,
  testId,
}: {
  value: number | null | undefined;
  /** raw input text → the value to commit (null = blank). */
  parse: (raw: string) => number | null;
  onCommit: (value: number | null) => void;
  disabled: boolean;
  placeholder?: string;
  testId: string;
}) {
  const shown = value == null ? "" : String(value);
  const [draft, setDraft] = useState<{ raw: string; committed: string } | null>(null);
  if (draft !== null && draft.committed !== shown) setDraft(null);
  return (
    <Input
      type="number"
      min={0}
      value={disabled || draft === null ? shown : draft.raw}
      onChange={e => {
        if (disabled) return;
        const raw = e.target.value;
        const next = parse(raw);
        setDraft({ raw, committed: next == null ? "" : String(next) });
        onCommit(next);
      }}
      disabled={disabled}
      title={disabled ? READ_ONLY_TITLE : undefined}
      placeholder={placeholder}
      className="h-7 text-xs w-full min-w-24 font-mono"
      data-testid={testId}
    />
  );
}
SCU_EOF
```

- [ ] **Step 5: Implement — `WarehousesTab.tsx`**

Replace the whole file `artifacts/studio/src/components/workspace/tabs/WarehousesTab.tsx` with:

```bash
mkdir -p artifacts/studio/src/components/workspace/tabs && cat > artifacts/studio/src/components/workspace/tabs/WarehousesTab.tsx <<'SCU_EOF'
import { useState } from "react";
import type { WarehouseCandidate, Scenario } from "@workspace/api-client-react";
import type { WarehouseOverride } from "@/components/tables/WarehouseTable";
import { Button } from "@/components/ui/button";
import { AlertTriangle } from "lucide-react";
import { completenessCountForWarehouse, idCollisionMessageForWarehouse, type PrecheckErrorLike } from "@/lib/precheckDisplay";
import { warehouseStatusPresentation } from "@/components/workspace/map/statusPresentation";
import { CreateEntityDialog } from "@/components/workspace/map/dialogs/CreateEntityDialog";
import { DataTable } from "@/components/data-table/DataTable";
import type { ColumnDef } from "@/components/data-table/types";
import { useEntityFileMenus } from "@/components/data-table/useEntityFileMenus";
import { DeleteRowButton, DraftNumberInput, READ_ONLY_TITLE, StatusToggle } from "@/components/data-table/entityCells";

// B5.2 — matches `addedWarehouseSchema` in
// artifacts/api-server/src/validation/inputs/pMedian.ts exactly (server-side
// source of truth for this shape).
export interface AddedWarehouse {
  id: string;
  city: string;
  state: string;
  lat: number;
  lng: number;
  capacity?: number | null;
  status: "active" | "forced_open" | "inactive";
  /** T9 — grid-mirror's auto-computed cosmetic label (T3's nextDisplayCode), same optional field CreateEntityDialog's map-click flow already writes. */
  displayCode?: string;
}

const STATUSES = ["active", "forced_open", "inactive"] as const;
type Status = (typeof STATUSES)[number];
const statusActiveClass = (s: Status) =>
  s === "forced_open" ? "bg-primary text-white" : s === "inactive" ? "bg-destructive text-white" : "bg-slate-200 text-foreground";

interface WarehousesTabProps {
  warehouses: WarehouseCandidate[];
  overrides: WarehouseOverride[];
  capacityMode: "none" | "uniform" | "per_wh";
  onChange: (next: WarehouseOverride[]) => void;
  /** Undefined while the scenario hasn't resolved yet — Upload/Download stay disabled until it has. */
  scenarioId?: number;
  /** Fired after a successful import apply, with the updated scenario — the caller (Workspace.tsx) refreshes its inputs draft from it. */
  onImportApplied?: (scenario: Scenario) => void;
  /** A5.3 — this same component (WarehouseTable + Upload/Download toolbar) is
   * reused as two-echelon-gold-au's Refineries tab: `dataset.warehouses`
   * already carries both models' facility candidates (mine rows are filtered
   * out below regardless of entity), and the backend's import/export routes
   * already accept `entity=refineries` (routes/scenarios.ts) — only the
   * entity string threaded through here, the testids, and the ImportDialog
   * title need to change per model. Defaults to "warehouses" so every
   * existing p-median-us call site (and its tests) is unaffected. */
  entity?: "warehouses" | "refineries";
  /** B5.2/B6.2 — scenario-local addedWarehouses (`PMedianInputs`) or
   * addedRefineries (`TwoEchelonInputs`, B6.2 — Workspace.tsx binds this
   * same prop name to `inputs.addedRefineries` for the entity="refineries"
   * reuse; the shape happens to match exactly, `capacity` simply stays
   * unset/ignored since capacityMode is always "none" for refineries). This
   * section renders whenever the caller actually wires
   * `onAddedWarehousesChange` — capability-gated (see that prop's own
   * comment), not `entity`-gated, so it's a no-op unless a model has this
   * concept wired at all. */
  addedWarehouses?: AddedWarehouse[];
  /** Fired on both add (append) and in-row edits (status/capacity) — full
   * replacement array, same `onChange`-out convention as every other tab.
   * Whether this is wired at all is the actual gate on rendering the
   * "Added ..." section below (see `addedSection`'s own comment — fix,
   * mirroring CustomersTab.tsx's B5.2 gating bug fix: a per-model gate on
   * `entity` alone silently missed the next reuse, exactly this repo's
   * most-recurring bug class per CLAUDE.md's Rounds 1-5). */
  onAddedWarehousesChange?: (next: AddedWarehouse[]) => void;
  /** Fired on delete only — kept separate from onAddedWarehousesChange because the caller (Workspace.tsx) also needs to purge any distanceOverrides referencing this id in the SAME atomic inputs update, which a generic "here's the new array" diff can't express cleanly. */
  onDeleteWarehouse?: (id: string) => void;
  /** B2.1's precheck errors for the current scenario — drives the inline "missing N distances" chip on added rows. Undefined/omitted degrades to "no warnings shown", never a crash. */
  precheckErrors?: PrecheckErrorLike[];
  /** Originally written for chens-cosmetics-cn's retired China dataset,
   * where every row's `state` was "". Defensive, not currently true of any
   * shipped dataset — measured 2026-09-28: every base warehouse/customer
   * row across all six models carries a non-blank state (max-coverage-us
   * included, since its US dataset swap). Gate on DATA PRESENCE
   * (Workspace.tsx computes this from the resolved dataset), not modelId —
   * drops the State column from the base table and the Added-warehouses
   * table, and drops the state-required check from the add-row form, for a
   * future dataset (or a scenario-added entity) that omits state. Defaults
   * true (every existing caller has real state data and is unaffected). */
  hasStateColumn?: boolean;
  /** B6 (JADE) — now only the ImportDialog preview grids' FilterMenu opt-in.
   * SCU-2.P4.10 (B2.2): the table's own FilterMenu shows on every model
   * above 10 rows, so it no longer reads this. */
  enableFilters?: boolean;
  /** SCU-2.P4.10 — narrows the Upload/Download expected-fields panel. */
  modelId?: string;
  /** History read-only (chen-bands-units decision 1h; SCU-2.P4.10 D2): every
   * capacity input, status button, delete button and the "+ Add" trigger —
   * base AND added rows — is disabled. Defaults false. */
  disabled?: boolean;
}

/** One effective row: a base candidate merged with its override, or an added entity. */
interface WarehouseRow {
  id: string;
  /** Added rows show their display code (pre-T9 data falls back to the uid). */
  displayId: string;
  city: string;
  state: string;
  lat: number;
  lng: number;
  zip?: string;
  capacity: number | null | undefined;
  status: Status;
  added: boolean;
}

// A1.1 → SCU-2.P4.10 (spec B2.1–B2.4, B2.8, D2) — the Warehouses tab (and,
// with entity="refineries", two-echelon-gold-au's Refineries tab) on the
// shared DataTable: base and added rows are two sections under ONE toolbar
// (Upload ▾, Download ▾, "+ Add {entity}" modal, FilterMenu above 10 rows on
// every model) and one pager (above 50 rows). The Workspace no longer renders
// the legacy `WarehouseTable` (still used by Studio.tsx).
export function WarehousesTab({
  warehouses,
  overrides,
  capacityMode,
  onChange,
  scenarioId,
  onImportApplied,
  entity = "warehouses",
  addedWarehouses = [],
  onAddedWarehousesChange,
  onDeleteWarehouse,
  precheckErrors = [],
  hasStateColumn = true,
  enableFilters = false,
  disabled = false,
  modelId,
}: WarehousesTabProps) {
  const files = useEntityFileMenus({ entity, testIdEntity: entity, modelId, scenarioId, onImportApplied, enableFilters });
  const [adding, setAdding] = useState(false);
  const candidates = warehouses.filter(w => w.kind !== "mine");
  const emptyLabel =
    entity === "refineries" ? "No refinery candidates in this dataset." : "No warehouse candidates in this dataset.";
  // B6.2 — singular label for the added section's copy (testids stay warehouse-worded, D4).
  const addedEntityLabel = entity === "refineries" ? "refinery" : "warehouse";
  const showCapacity = capacityMode === "per_wh";

  function upsertBase(id: string, patch: Partial<WarehouseOverride>) {
    if (disabled) return;
    const existing = overrides.find(o => o.id === id);
    const merged: WarehouseOverride = { id, status: existing?.status ?? "active", capacity: existing?.capacity, ...patch };
    const rest = overrides.filter(o => o.id !== id);
    onChange(merged.status === "active" && merged.capacity == null ? rest : [...rest, merged]);
  }
  function upsertAdded(id: string, patch: Partial<AddedWarehouse>) {
    if (disabled || !onAddedWarehousesChange) return;
    onAddedWarehousesChange(addedWarehouses.map(w => (w.id === id ? { ...w, ...patch } : w)));
  }

  const rows: WarehouseRow[] = [
    ...candidates.map(w => {
      const o = overrides.find(x => x.id === w.id);
      return {
        id: w.id,
        displayId: w.id,
        city: w.city,
        state: w.state,
        lat: w.lat,
        lng: w.lng,
        zip: w.zip ?? undefined,
        capacity: o?.capacity,
        status: o?.status ?? "active",
        added: false,
      };
    }),
    ...addedWarehouses.map(w => ({
      id: w.id,
      displayId: w.displayCode ?? w.id,
      city: w.city,
      state: w.state,
      lat: w.lat,
      lng: w.lng,
      capacity: w.capacity,
      status: w.status,
      added: true,
    })),
  ];

  // Rebuilt every render: cells close over live props (see DistancesTab).
  const idColumn = (added: boolean): ColumnDef<WarehouseRow> => ({
    id: "id",
    header: "ID",
    kind: "text",
    filter: "text",
    value: r => r.displayId,
    cellClassName: "font-mono text-xs",
    cell: r => {
      if (!added) return r.displayId;
      const missing = completenessCountForWarehouse(precheckErrors, r.id);
      const collision = idCollisionMessageForWarehouse(precheckErrors, r.id);
      return (
        <div className="flex items-center gap-1">
          {r.displayId}
          {(missing != null || collision) && (
            <span
              title={
                collision ??
                `Missing distances to ${missing} customer${missing === 1 ? "" : "s"} — see the Distances tab, or download/upload a template.`
              }
              data-testid={`warning-precheck-added-warehouse-${r.id}`}
              className="inline-flex items-center gap-0.5 text-[10px] text-amber-700 bg-amber-100 border border-amber-300 rounded px-1"
            >
              <AlertTriangle className="w-3 h-3" />
              {collision ? "ID collision" : `Missing ${missing} distance${missing === 1 ? "" : "s"}`}
            </span>
          )}
        </div>
      );
    },
  });
  const commonColumns = (added: boolean): ColumnDef<WarehouseRow>[] => [
    idColumn(added),
    { id: "city", header: "City", kind: "text", filter: "text", value: r => r.city, cellClassName: "text-xs", cell: r => r.city },
    ...(hasStateColumn
      ? [
          {
            id: "state",
            header: "State",
            kind: "text",
            filter: "select",
            value: r => r.state || null,
            cellClassName: "text-xs",
            cell: r => r.state,
          } satisfies ColumnDef<WarehouseRow>,
        ]
      : []),
    {
      id: "lat",
      header: "Latitude",
      kind: "number",
      value: r => r.lat,
      cellClassName: "text-xs font-mono",
      cell: r => r.lat.toFixed(4),
    },
    {
      id: "lng",
      header: "Longitude",
      kind: "number",
      value: r => r.lng,
      cellClassName: "text-xs font-mono",
      cell: r => r.lng.toFixed(4),
    },
  ];
  const hasZip = candidates.some(w => w.zip);
  const zipColumn: ColumnDef<WarehouseRow> = {
    id: "zip",
    header: "Zip",
    kind: "text",
    filter: "text",
    value: r => r.zip ?? null,
    cellClassName: "text-xs font-mono",
    cell: r => r.zip ?? "—",
  };
  const capacityColumn = (added: boolean): ColumnDef<WarehouseRow> => ({
    id: "capacity",
    header: "Capacity",
    kind: "number",
    value: r => r.capacity ?? null,
    cell: r => (
      <DraftNumberInput
        value={r.capacity}
        // base: integer (WarehouseTable's parseInt); added: decimal (the added section's parseFloat)
        parse={raw => (raw === "" ? null : Math.max(0, (added ? parseFloat(raw) : parseInt(raw, 10)) || 0))}
        onCommit={capacity => (added ? upsertAdded(r.id, { capacity }) : upsertBase(r.id, { capacity }))}
        disabled={disabled}
        placeholder="uniform"
        testId={added ? `input-added-wh-capacity-${r.id}` : `input-wh-capacity-${r.id}`}
      />
    ),
  });
  const statusColumn = (added: boolean): ColumnDef<WarehouseRow> => ({
    id: "status",
    header: "Status",
    kind: "enum",
    // The filter option value is the presentation LABEL (e2e ticks `checkbox-filter-status-Fixed-Open`).
    value: r => warehouseStatusPresentation[r.status].label,
    cell: r => (
      <StatusToggle
        options={STATUSES}
        value={r.status}
        labelOf={s => warehouseStatusPresentation[s].label}
        activeClassOf={statusActiveClass}
        onChange={status => (added ? upsertAdded(r.id, { status }) : upsertBase(r.id, { status }))}
        disabled={disabled}
        testIdOf={s => (added ? `button-added-wh-${r.id}-${s}` : `button-wh-${r.id}-${s}`)}
      />
    ),
  });
  const baseColumns: ColumnDef<WarehouseRow>[] = [
    ...commonColumns(false),
    ...(hasZip ? [zipColumn] : []),
    ...(showCapacity ? [capacityColumn(false)] : []),
    statusColumn(false),
  ];
  const addedColumns: ColumnDef<WarehouseRow>[] = [
    ...commonColumns(true),
    ...(showCapacity ? [capacityColumn(true)] : []),
    statusColumn(true),
    {
      id: "delete",
      header: "",
      kind: "text",
      filter: false,
      value: () => null,
      cell: r => (
        <DeleteRowButton
          label={`Delete added warehouse ${r.id}`}
          onClick={() => onDeleteWarehouse?.(r.id)}
          disabled={disabled}
          testId={`button-delete-added-warehouse-${r.id}`}
        />
      ),
    },
  ];

  const addTrigger = onAddedWarehousesChange != null && (
    <Button
      size="sm"
      variant="outline"
      className="h-7 px-2 text-xs"
      onClick={() => setAdding(true)}
      disabled={disabled}
      title={disabled ? READ_ONLY_TITLE : undefined}
      data-testid="button-add-warehouse-row"
    >
      + Add {addedEntityLabel}
    </Button>
  );

  return (
    <div data-testid={`${entity}-tab`}>
      <DataTable<WarehouseRow>
        rows={rows}
        rowKey={r => `${r.added ? "added" : "base"}:${r.id}`}
        columns={baseColumns}
        ctx={{ readOnly: disabled, demandEditable: false, isAdded: r => r.added }}
        testIds={{
          toolbar: `${entity}-tab-toolbar`,
          pagerPrev: `button-${entity}-prev`,
          pagerNext: `button-${entity}-next`,
          pageIndicator: `${entity}-page-indicator`,
        }}
        toolbar={{ upload: files.upload, download: files.download, add: addTrigger }}
        sections={[
          {
            id: "base",
            includes: r => !r.added,
            scrollClassName: "max-h-[60vh] overflow-y-auto",
            emptyState: (
              <p className="text-sm text-muted-foreground" data-testid={`${entity}-tab-empty`}>
                {emptyLabel}
              </p>
            ),
          },
          ...(onAddedWarehousesChange != null
            ? [
                {
                  id: "added",
                  title: entity === "refineries" ? "Added refineries" : "Added warehouses",
                  testId: "added-warehouses-section",
                  includes: (r: WarehouseRow) => r.added,
                  columns: addedColumns,
                  rowTestId: (r: WarehouseRow) => `row-added-warehouse-${r.id}`,
                  scrollClassName: "max-h-[40vh] overflow-y-auto",
                  emptyState: (
                    <p className="text-xs text-muted-foreground" data-testid="added-warehouses-empty">
                      No added {addedEntityLabel}s yet — use "+ Add {addedEntityLabel}" above to create one.
                    </p>
                  ),
                },
              ]
            : []),
        ]}
      />
      {adding && (
        <CreateEntityDialog
          source="table"
          entityKind={entity === "refineries" ? "refinery" : "warehouse"}
          capacityMode={capacityMode}
          hasStateColumn={hasStateColumn}
          existingCodes={addedWarehouses.map(w => w.displayCode).filter((c): c is string => !!c)}
          onCreate={r => {
            if (r.kind === "warehouse" || r.kind === "refinery") onAddedWarehousesChange?.([...addedWarehouses, r.entity]);
            setAdding(false);
          }}
          onCancel={() => setAdding(false)}
        />
      )}
      {files.dialog}
    </div>
  );
}
SCU_EOF
```

- [ ] **Step 6: Wire Workspace, flip the D2 guard, rewrite the by-design test breaks**

Adds `modelId` to both `<WarehousesTab` mounts (and rewrites the stale `enableFilters` comment), and rewrites the by-design breaks in `WarehousesTab.test.tsx` (FilterMenu on all models, menus, modal), `Workspace.test.tsx` / `Workspace.Analytics.test.tsx` (inline form → modal ids; payload has the derived display code and no `capacity`), `Workspace.TwoEchelon.test.tsx` / `Workspace.Brazil.test.tsx` (Download ▾ trigger).:

```bash
python3 - <<'PY'
import pathlib
EDITS = [
    ('artifacts/studio/src/__tests__/WarehousesTab.test.tsx',
     '''import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WarehousesTab } from "@/components/workspace/tabs/WarehousesTab";

const warehouses = [''',
     '''import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WarehousesTab } from "@/components/workspace/tabs/WarehousesTab";
import { chooseInputDownload, chooseUpload } from "@/__tests__/helpers/inputTable";

const warehouses = ['''),
    ('artifacts/studio/src/__tests__/WarehousesTab.test.tsx',
     '''    }));

    it("defaults to false: no FilterMenu even with >10 rows (other-model behavior unchanged)", () => {
      render(<WarehousesTab warehouses={manyWarehouses} overrides={[]} capacityMode="none" onChange={vi.fn()} />);
      expect(screen.queryByTestId("button-filter-menu-trigger")).not.toBeInTheDocument();
    });
''',
     '''    }));

    // SCU-2.P4.10 (spec B2.2) — the table's FilterMenu shows above 10 rows on
    // EVERY model; enableFilters now only reaches ImportDialog's preview grids.
    it("without enableFilters the FilterMenu still shows above 10 rows (B2.2: all models)", () => {
      render(<WarehousesTab warehouses={manyWarehouses} overrides={[]} capacityMode="none" onChange={vi.fn()} />);
      expect(screen.getByTestId("button-filter-menu-trigger")).toBeInTheDocument();
    });
'''),
    ('artifacts/studio/src/__tests__/WarehousesTab.test.tsx',
     '''      const toolbar = screen.getByTestId("warehouses-tab-toolbar");
      // Import/Export buttons live in the toolbar...
      expect(toolbar).toContainElement(screen.getByTestId("button-export-warehouses-csv"));
      expect(toolbar).toContainElement(screen.getByTestId("button-import-warehouses"));
      // ...and so does the FilterMenu trigger — one row, not a separate one.''',
     '''      const toolbar = screen.getByTestId("warehouses-tab-toolbar");
      // Import/Export buttons live in the toolbar...
      expect(toolbar).toContainElement(screen.getByTestId("button-download-warehouses"));
      expect(toolbar).toContainElement(screen.getByTestId("button-import-warehouses"));
      // ...and so does the FilterMenu trigger — one row, not a separate one.'''),
    ('artifacts/studio/src/__tests__/WarehousesTab.test.tsx',
     '''    });

    it("non-JADE tab (enableFilters omitted): no FilterMenu anywhere, even with >10 rows", () => {
      render(<WarehousesTab warehouses={manyWarehouses} overrides={[]} capacityMode="none" onChange={vi.fn()} />);
      expect(screen.queryByTestId("button-filter-menu-trigger")).not.toBeInTheDocument();
      // The toolbar still renders (Import/Export unaffected).
      expect(screen.getByTestId("warehouses-tab-toolbar")).toBeInTheDocument();
    });
  });''',
     '''    });

    it("non-JADE tab (enableFilters omitted): the FilterMenu sits in the same toolbar row (B2.2)", () => {
      render(<WarehousesTab warehouses={manyWarehouses} overrides={[]} capacityMode="none" onChange={vi.fn()} />);
      expect(screen.getByTestId("warehouses-tab-toolbar")).toContainElement(screen.getByTestId("button-filter-menu-trigger"));
    });
  });'''),
    ('artifacts/studio/src/__tests__/WarehousesTab.test.tsx',
     '''      </ExportProviderTestWrapper>,
    );
    expect(screen.getByTestId("button-export-warehouses-csv")).toBeDisabled();
    expect(screen.getByTestId("button-export-warehouses-json")).toBeDisabled();
    expect(screen.getByTestId("button-import-warehouses")).toBeDisabled();
  });''',
     '''      </ExportProviderTestWrapper>,
    );
    // SCU-2.P4 (B2.3/B2.4) — one Download ▾ trigger now carries the disabled state.
    expect(screen.getByTestId("button-download-warehouses")).toBeDisabled();
    expect(screen.getByTestId("button-import-warehouses")).toBeDisabled();
  });'''),
    ('artifacts/studio/src/__tests__/WarehousesTab.test.tsx',
     '''    );

    await userEvent.click(screen.getByTestId("button-export-warehouses-csv"));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());''',
     '''    );

    chooseInputDownload("warehouses", "csv");

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());'''),
    ('artifacts/studio/src/__tests__/WarehousesTab.test.tsx',
     '''    );

    await userEvent.click(screen.getByTestId("button-export-warehouses-json"));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());''',
     '''    );

    chooseInputDownload("warehouses", "json");

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());'''),
    ('artifacts/studio/src/__tests__/WarehousesTab.test.tsx',
     '''      </ExportProvider>,
    );
    const csvButton = screen.getByTestId("button-export-warehouses-csv");
    expect(csvButton).not.toBeDisabled();
''',
     '''      </ExportProvider>,
    );
    // SCU-2.P4.10 (B2.4) — the Download ▾ trigger carries the disabled state.
    const csvButton = screen.getByTestId("button-download-warehouses");
    expect(csvButton).not.toBeDisabled();
'''),
    ('artifacts/studio/src/__tests__/WarehousesTab.test.tsx',
     '''    expect(screen.queryByText("Import warehouses")).not.toBeInTheDocument();

    await userEvent.click(screen.getByTestId("button-import-warehouses"));

    expect(screen.getByText("Import warehouses")).toBeInTheDocument();''',
     '''    expect(screen.queryByText("Import warehouses")).not.toBeInTheDocument();

    chooseUpload("warehouses", "csv");

    expect(screen.getByText("Import warehouses")).toBeInTheDocument();'''),
    ('artifacts/studio/src/__tests__/WarehousesTab.test.tsx',
     '    );\n\n    await userEvent.click(screen.getByTestId("button-import-warehouses"));\n    const file = new File(["id,status\\nCHI,active"], "warehouses.csv", { type: "text/csv" });\n    await userEvent.upload(screen.getByTestId("input-import-file-warehouses"), file);',
     '    );\n\n    chooseUpload("warehouses", "csv");\n    const file = new File(["id,status\\nCHI,active"], "warehouses.csv", { type: "text/csv" });\n    await userEvent.upload(screen.getByTestId("input-import-file-warehouses"), file);'),
    ('artifacts/studio/src/__tests__/WarehousesTab.test.tsx',
     '''
    await userEvent.click(screen.getByTestId("button-add-warehouse-row"));
    await userEvent.type(screen.getByTestId("input-new-warehouse-city"), "Denver");
    await userEvent.type(screen.getByTestId("input-new-warehouse-state"), "CO");
    await userEvent.type(screen.getByTestId("input-new-warehouse-lat"), "39.74");
    await userEvent.type(screen.getByTestId("input-new-warehouse-lng"), "-104.99");
    await userEvent.click(screen.getByTestId("button-add-warehouse-confirm"));

    // T9 — Denver/CO is a real gazetteer hit, so the blur off the State''',
     '''
    await userEvent.click(screen.getByTestId("button-add-warehouse-row"));
    await userEvent.type(screen.getByTestId("create-entity-city"), "Denver");
    await userEvent.type(screen.getByTestId("create-entity-state"), "CO");
    await userEvent.type(screen.getByTestId("create-entity-lat"), "39.74");
    await userEvent.type(screen.getByTestId("create-entity-lng"), "-104.99");
    await userEvent.click(screen.getByTestId("create-entity-submit"));

    // T9 — Denver/CO is a real gazetteer hit, so the blur off the State'''),
    ('artifacts/studio/src/__tests__/WarehousesTab.test.tsx',
     '''      lat: 39.74,
      lng: -104.99,
      capacity: null,
      status: "active",
      displayCode: "WH-CO-DENVER-01",
    });
    expect(added.id).toMatch(/^aw-/);
  });''',
     '''      lat: 39.74,
      lng: -104.99,
      status: "active",
      displayCode: "WH-CO-DENVER-01",
    });
    // SCU-2.P4.10 (B2.8) — the modal omits `capacity` when capacityMode has no
    // per-warehouse capacity (the map flow's convention); the inline form sent null.
    expect(added).not.toHaveProperty("capacity");
    expect(added.id).toMatch(/^aw-/);
  });'''),
    ('artifacts/studio/src/__tests__/WarehousesTab.test.tsx',
     '''
    await userEvent.click(screen.getByTestId("button-add-warehouse-row"));
    await userEvent.type(screen.getByTestId("input-new-warehouse-lat"), "39.74");
    await userEvent.type(screen.getByTestId("input-new-warehouse-lng"), "-104.99");
    await userEvent.click(screen.getByTestId("button-add-warehouse-confirm"));

    expect(onAddedWarehousesChange).not.toHaveBeenCalled();
    expect(screen.getByTestId("text-add-warehouse-error")).toBeInTheDocument();
  });
''',
     '''
    await userEvent.click(screen.getByTestId("button-add-warehouse-row"));
    await userEvent.type(screen.getByTestId("create-entity-lat"), "39.74");
    await userEvent.type(screen.getByTestId("create-entity-lng"), "-104.99");
    await userEvent.click(screen.getByTestId("create-entity-submit"));

    expect(onAddedWarehousesChange).not.toHaveBeenCalled();
    expect(screen.getByTestId("create-entity-error")).toBeInTheDocument();
  });
'''),
    ('artifacts/studio/src/__tests__/WarehousesTab.test.tsx',
     '''
    await userEvent.click(screen.getByTestId("button-add-warehouse-row"));
    await userEvent.type(screen.getByTestId("input-new-warehouse-city"), "Chicago");
    await userEvent.type(screen.getByTestId("input-new-warehouse-state"), "IL");
    fireEvent.blur(screen.getByTestId("input-new-warehouse-state"));
    // Manually override the auto-filled displayCode to collide.
    await userEvent.clear(screen.getByTestId("input-new-warehouse-display-code"));
    await userEvent.type(screen.getByTestId("input-new-warehouse-display-code"), "DUPE");
    await userEvent.click(screen.getByTestId("button-add-warehouse-confirm"));

    expect(onAddedWarehousesChange).not.toHaveBeenCalled();
    expect(screen.getByTestId("text-add-warehouse-error")).toBeInTheDocument();
  });
''',
     '''
    await userEvent.click(screen.getByTestId("button-add-warehouse-row"));
    await userEvent.type(screen.getByTestId("create-entity-city"), "Chicago");
    await userEvent.type(screen.getByTestId("create-entity-state"), "IL");
    fireEvent.blur(screen.getByTestId("create-entity-state"));
    // Manually override the auto-filled displayCode to collide.
    await userEvent.clear(screen.getByTestId("create-entity-display-code"));
    await userEvent.type(screen.getByTestId("create-entity-display-code"), "DUPE");
    await userEvent.click(screen.getByTestId("create-entity-submit"));

    expect(onAddedWarehousesChange).not.toHaveBeenCalled();
    expect(screen.getByTestId("create-entity-error")).toBeInTheDocument();
  });
'''),
    ('artifacts/studio/src/__tests__/WarehousesTab.test.tsx',
     '''    );
    await userEvent.click(screen.getByTestId("button-add-warehouse-row"));
    await userEvent.type(screen.getByTestId("input-new-warehouse-city"), "Denver");
    await userEvent.type(screen.getByTestId("input-new-warehouse-state"), "CO");
    fireEvent.blur(screen.getByTestId("input-new-warehouse-state"));

    expect(screen.getByTestId("input-new-warehouse-lat")).toHaveValue(39.76185);
    expect(screen.getByTestId("input-new-warehouse-lng")).toHaveValue(-104.881105);
    expect(screen.getByTestId("input-new-warehouse-display-code")).toHaveValue("WH-CO-DENVER-01");
  });
''',
     '''    );
    await userEvent.click(screen.getByTestId("button-add-warehouse-row"));
    await userEvent.type(screen.getByTestId("create-entity-city"), "Denver");
    await userEvent.type(screen.getByTestId("create-entity-state"), "CO");
    fireEvent.blur(screen.getByTestId("create-entity-state"));

    // SCU-2.P4.10 — the modal's lat/lng are text inputs (string values).
    expect(screen.getByTestId("create-entity-lat")).toHaveValue("39.76185");
    expect(screen.getByTestId("create-entity-lng")).toHaveValue("-104.881105");
    expect(screen.getByTestId("create-entity-display-code")).toHaveValue("WH-CO-DENVER-01");
  });
'''),
    ('artifacts/studio/src/__tests__/WarehousesTab.test.tsx',
     '''    );
    await userEvent.click(screen.getByTestId("button-add-warehouse-row"));
    await userEvent.type(screen.getByTestId("input-new-warehouse-city"), "Denver");
    await userEvent.type(screen.getByTestId("input-new-warehouse-state"), "CO");
    fireEvent.blur(screen.getByTestId("input-new-warehouse-state"));
    expect(screen.getByTestId("input-new-warehouse-lat")).toHaveValue(39.76185);

    // Manual focus+edit ungreys the cell and stops future auto-fills.
    await userEvent.clear(screen.getByTestId("input-new-warehouse-lat"));
    await userEvent.type(screen.getByTestId("input-new-warehouse-lat"), "1.2345");
    expect(screen.getByTestId("input-new-warehouse-lat")).toHaveValue(1.2345);

    // Re-triggering the City/State blur (e.g. a further edit to State) must
    // not clobber the student's manual lat value.
    fireEvent.blur(screen.getByTestId("input-new-warehouse-state"));
    expect(screen.getByTestId("input-new-warehouse-lat")).toHaveValue(1.2345);
  });

  it("a gazetteer miss (unknown city/state) leaves Lat/Lng blank for manual entry, and no display code is assigned", async () => {
    render(
      <WarehousesTab''',
     '''    );
    await userEvent.click(screen.getByTestId("button-add-warehouse-row"));
    await userEvent.type(screen.getByTestId("create-entity-city"), "Denver");
    await userEvent.type(screen.getByTestId("create-entity-state"), "CO");
    fireEvent.blur(screen.getByTestId("create-entity-state"));
    expect(screen.getByTestId("create-entity-lat")).toHaveValue("39.76185");

    // Manual focus+edit ungreys the cell and stops future auto-fills.
    await userEvent.clear(screen.getByTestId("create-entity-lat"));
    await userEvent.type(screen.getByTestId("create-entity-lat"), "1.2345");
    expect(screen.getByTestId("create-entity-lat")).toHaveValue("1.2345");

    // Re-triggering the City/State blur (e.g. a further edit to State) must
    // not clobber the student's manual lat value.
    fireEvent.blur(screen.getByTestId("create-entity-state"));
    expect(screen.getByTestId("create-entity-lat")).toHaveValue("1.2345");
  });

  // SCU-2.P4.10 (B2.8) — the modal always derives a display code from
  // City/State (the map flow's rule); a gazetteer miss only leaves lat/lng blank.
  it("a gazetteer miss (unknown city/state) leaves Lat/Lng blank for manual entry; the display code is still derived", async () => {
    render(
      <WarehousesTab'''),
    ('artifacts/studio/src/__tests__/WarehousesTab.test.tsx',
     '''    );
    await userEvent.click(screen.getByTestId("button-add-warehouse-row"));
    await userEvent.type(screen.getByTestId("input-new-warehouse-city"), "Nowheresville");
    await userEvent.type(screen.getByTestId("input-new-warehouse-state"), "ZZ");
    fireEvent.blur(screen.getByTestId("input-new-warehouse-state"));

    expect(screen.getByTestId("input-new-warehouse-lat")).toHaveValue(null);
    expect(screen.getByTestId("input-new-warehouse-lng")).toHaveValue(null);
    expect(screen.getByTestId("input-new-warehouse-display-code")).toHaveValue("");
  });
});''',
     '''    );
    await userEvent.click(screen.getByTestId("button-add-warehouse-row"));
    await userEvent.type(screen.getByTestId("create-entity-city"), "Nowheresville");
    await userEvent.type(screen.getByTestId("create-entity-state"), "ZZ");
    fireEvent.blur(screen.getByTestId("create-entity-state"));

    expect(screen.getByTestId("create-entity-lat")).toHaveValue("");
    expect(screen.getByTestId("create-entity-lng")).toHaveValue("");
    expect(screen.getByTestId("create-entity-display-code")).toHaveValue("WH-ZZ-NOWHERESVILLE-01");
  });
});'''),
    ('artifacts/studio/src/__tests__/WarehousesTab.test.tsx',
     '''    );

    await userEvent.click(screen.getByTestId("button-export-refineries-csv"));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());''',
     '''    );

    chooseInputDownload("refineries", "csv");

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());'''),
    ('artifacts/studio/src/__tests__/WarehousesTab.test.tsx',
     '''    );
    expect(screen.queryByText("Import refineries")).not.toBeInTheDocument();
    await userEvent.click(screen.getByTestId("button-import-refineries"));
    expect(screen.getByText("Import refineries")).toBeInTheDocument();
    expect(screen.getByTestId("input-import-file-refineries")).toBeInTheDocument();''',
     '''    );
    expect(screen.queryByText("Import refineries")).not.toBeInTheDocument();
    chooseUpload("refineries", "csv");
    expect(screen.getByText("Import refineries")).toBeInTheDocument();
    expect(screen.getByTestId("input-import-file-refineries")).toBeInTheDocument();'''),
    ('artifacts/studio/src/__tests__/WarehousesTab.test.tsx',
     '''
    await userEvent.click(screen.getByTestId("button-add-warehouse-row"));
    await userEvent.type(screen.getByTestId("input-new-warehouse-city"), "Kalgoorlie West");
    await userEvent.type(screen.getByTestId("input-new-warehouse-state"), "WA");
    await userEvent.type(screen.getByTestId("input-new-warehouse-lat"), "-30.8");
    await userEvent.type(screen.getByTestId("input-new-warehouse-lng"), "121.3");
    // No capacity input rendered at all under capacityMode="none".
    expect(screen.queryByTestId("input-new-warehouse-capacity")).not.toBeInTheDocument();
    await userEvent.click(screen.getByTestId("button-add-warehouse-confirm"));

    // T9 — "Kalgoorlie West"/WA is a gazetteer miss (US-only gazetteer, this''',
     '''
    await userEvent.click(screen.getByTestId("button-add-warehouse-row"));
    await userEvent.type(screen.getByTestId("create-entity-city"), "Kalgoorlie West");
    await userEvent.type(screen.getByTestId("create-entity-state"), "WA");
    await userEvent.type(screen.getByTestId("create-entity-lat"), "-30.8");
    await userEvent.type(screen.getByTestId("create-entity-lng"), "121.3");
    // No capacity input rendered at all under capacityMode="none".
    expect(screen.queryByTestId("create-entity-capacity")).not.toBeInTheDocument();
    await userEvent.click(screen.getByTestId("create-entity-submit"));

    // T9 — "Kalgoorlie West"/WA is a gazetteer miss (US-only gazetteer, this'''),
    ('artifacts/studio/src/__tests__/WarehousesTab.test.tsx',
     '''      lat: -30.8,
      lng: 121.3,
      capacity: null,
      status: "active",
    });
    expect(added.id).toMatch(/^aw-/);
    expect(added.displayCode).toBeUndefined();
  });
''',
     '''      lat: -30.8,
      lng: 121.3,
      status: "active",
    });
    expect(added).not.toHaveProperty("capacity");
    expect(added.id).toMatch(/^aw-/);
    // SCU-2.P4.10 (B2.8) — always derived (refineries reuse the "wh" prefix, DD-7).
    expect(added.displayCode).toBe("WH-WA-KALGOORLIEWEST-01");
  });
'''),
    ('artifacts/studio/src/__tests__/WarehousesTab.test.tsx',
     '''    expect(screen.getByTestId("warehouses-tab")).toBeInTheDocument();
    expect(screen.getByTestId("warehouses-tab-toolbar")).toBeInTheDocument();
    expect(screen.getByTestId("button-export-warehouses-csv")).toBeInTheDocument();
    expect(screen.getByTestId("button-import-warehouses")).toBeInTheDocument();
    expect(screen.getByText("CHI")).toBeInTheDocument();''',
     '''    expect(screen.getByTestId("warehouses-tab")).toBeInTheDocument();
    expect(screen.getByTestId("warehouses-tab-toolbar")).toBeInTheDocument();
    expect(screen.getByTestId("button-download-warehouses")).toBeInTheDocument();
    expect(screen.getByTestId("button-import-warehouses")).toBeInTheDocument();
    expect(screen.getByText("CHI")).toBeInTheDocument();'''),
    ('artifacts/studio/src/__tests__/WarehousesTab.test.tsx',
     '''      />,
    );
    expect(screen.queryByTestId("add-warehouse-row-form")).not.toBeInTheDocument();
    await userEvent.click(screen.getByTestId("button-add-warehouse-row"));
    expect(screen.getByTestId("add-warehouse-row-form")).toBeInTheDocument();
    expect(screen.getByTestId("warehouses-tab")).toBeInTheDocument();
    expect(screen.getByText("CHI")).toBeInTheDocument();''',
     '''      />,
    );
    expect(screen.queryByTestId("create-entity-dialog")).not.toBeInTheDocument();
    await userEvent.click(screen.getByTestId("button-add-warehouse-row"));
    expect(screen.getByTestId("create-entity-dialog")).toBeInTheDocument();
    expect(screen.getByTestId("warehouses-tab")).toBeInTheDocument();
    expect(screen.getByText("CHI")).toBeInTheDocument();'''),
    ('artifacts/studio/src/__tests__/WarehousesTab.test.tsx',
     '''    );
    await userEvent.click(screen.getByTestId("button-add-warehouse-row"));
    expect(screen.queryByTestId("input-new-warehouse-state")).not.toBeInTheDocument();
  });
''',
     '''    );
    await userEvent.click(screen.getByTestId("button-add-warehouse-row"));
    expect(screen.queryByTestId("create-entity-state")).not.toBeInTheDocument();
  });
'''),
    ('artifacts/studio/src/__tests__/WarehousesTab.test.tsx',
     '''    );
    await userEvent.click(screen.getByTestId("button-add-warehouse-row"));
    await userEvent.type(screen.getByTestId("input-new-warehouse-city"), "Shanghai");
    await userEvent.type(screen.getByTestId("input-new-warehouse-lat"), "31.23");
    await userEvent.type(screen.getByTestId("input-new-warehouse-lng"), "121.47");
    await userEvent.click(screen.getByTestId("button-add-warehouse-confirm"));

    expect(onAddedWarehousesChange).toHaveBeenCalledTimes(1);''',
     '''    );
    await userEvent.click(screen.getByTestId("button-add-warehouse-row"));
    await userEvent.type(screen.getByTestId("create-entity-city"), "Shanghai");
    await userEvent.type(screen.getByTestId("create-entity-lat"), "31.23");
    await userEvent.type(screen.getByTestId("create-entity-lng"), "121.47");
    await userEvent.click(screen.getByTestId("create-entity-submit"));

    expect(onAddedWarehousesChange).toHaveBeenCalledTimes(1);'''),
    ('artifacts/studio/src/__tests__/WarehousesTab.test.tsx',
     '''    );
    await userEvent.click(screen.getByTestId("button-add-warehouse-row"));
    await userEvent.type(screen.getByTestId("input-new-warehouse-lat"), "31.23");
    await userEvent.type(screen.getByTestId("input-new-warehouse-lng"), "121.47");
    await userEvent.click(screen.getByTestId("button-add-warehouse-confirm"));

    expect(onAddedWarehousesChange).not.toHaveBeenCalled();
    expect(screen.getByTestId("text-add-warehouse-error")).toHaveTextContent("City is required.");
  });
});''',
     '''    );
    await userEvent.click(screen.getByTestId("button-add-warehouse-row"));
    await userEvent.type(screen.getByTestId("create-entity-lat"), "31.23");
    await userEvent.type(screen.getByTestId("create-entity-lng"), "121.47");
    await userEvent.click(screen.getByTestId("create-entity-submit"));

    expect(onAddedWarehousesChange).not.toHaveBeenCalled();
    expect(screen.getByTestId("create-entity-error")).toHaveTextContent("City is required.");
  });
});'''),
    ('artifacts/studio/src/__tests__/Workspace.Analytics.test.tsx',
     '''    fireEvent.click(screen.getByTestId("sidebar-input-warehouses"));
    fireEvent.click(screen.getByTestId("button-add-warehouse-row"));
    fireEvent.change(screen.getByTestId("input-new-warehouse-city"), { target: { value: "Denver" } });
    fireEvent.change(screen.getByTestId("input-new-warehouse-state"), { target: { value: "CO" } });
    fireEvent.change(screen.getByTestId("input-new-warehouse-lat"), { target: { value: "39.74" } });
    fireEvent.change(screen.getByTestId("input-new-warehouse-lng"), { target: { value: "-104.99" } });
    fireEvent.click(screen.getByTestId("button-add-warehouse-confirm"));

    await waitFor(() =>''',
     '''    fireEvent.click(screen.getByTestId("sidebar-input-warehouses"));
    fireEvent.click(screen.getByTestId("button-add-warehouse-row"));
    fireEvent.change(screen.getByTestId("create-entity-city"), { target: { value: "Denver" } });
    fireEvent.change(screen.getByTestId("create-entity-state"), { target: { value: "CO" } });
    fireEvent.change(screen.getByTestId("create-entity-lat"), { target: { value: "39.74" } });
    fireEvent.change(screen.getByTestId("create-entity-lng"), { target: { value: "-104.99" } });
    fireEvent.click(screen.getByTestId("create-entity-submit"));

    await waitFor(() =>'''),
    ('artifacts/studio/src/__tests__/Workspace.TwoEchelon.test.tsx',
     '''    renderWorkspace();
    fireEvent.click(screen.getByTestId("sidebar-input-refineries"));
    expect(screen.getByTestId("button-export-refineries-csv")).toBeInTheDocument();
    expect(screen.getByTestId("button-import-refineries")).toBeInTheDocument();
    expect(screen.queryByTestId("button-export-warehouses-csv")).not.toBeInTheDocument();
  });
''',
     '''    renderWorkspace();
    fireEvent.click(screen.getByTestId("sidebar-input-refineries"));
    // SCU-2.P4.10 (B2.3/B2.4) — Download ▾ / Upload ▾ triggers.
    expect(screen.getByTestId("button-download-refineries")).toBeInTheDocument();
    expect(screen.getByTestId("button-import-refineries")).toBeInTheDocument();
    expect(screen.queryByTestId("button-download-warehouses")).not.toBeInTheDocument();
  });
'''),
    ('artifacts/studio/src/__tests__/Workspace.test.tsx',
     '''    fireEvent.click(screen.getByTestId("button-add-warehouse-row"));
    // T9 (grid-mirror) — the manual "ID" input is gone; `id` is now a hidden
    // T3 stable uid (`aw-<uuid>`) minted by handleAddRow itself, and
    // `displayCode` (left blank here — never focused, so City/State's blur
    // auto-fill never fires) is the optional human-facing label.
    fireEvent.change(screen.getByTestId("input-new-warehouse-city"), { target: { value: "Denver" } });
    fireEvent.change(screen.getByTestId("input-new-warehouse-state"), { target: { value: "CO" } });
    fireEvent.change(screen.getByTestId("input-new-warehouse-lat"), { target: { value: "39.74" } });
    fireEvent.change(screen.getByTestId("input-new-warehouse-lng"), { target: { value: "-104.99" } });
    fireEvent.click(screen.getByTestId("button-add-warehouse-confirm"));
''',
     '''    fireEvent.click(screen.getByTestId("button-add-warehouse-row"));
    // T9 (grid-mirror) — `id` is a hidden T3 stable uid (`aw-<uuid>`).
    // SCU-2.P4.10 (B2.8) — the add flow is the CreateEntityDialog modal,
    // which derives `displayCode` from City/State.
    fireEvent.change(screen.getByTestId("create-entity-city"), { target: { value: "Denver" } });
    fireEvent.change(screen.getByTestId("create-entity-state"), { target: { value: "CO" } });
    fireEvent.change(screen.getByTestId("create-entity-lat"), { target: { value: "39.74" } });
    fireEvent.change(screen.getByTestId("create-entity-lng"), { target: { value: "-104.99" } });
    fireEvent.click(screen.getByTestId("create-entity-submit"));
'''),
    ('artifacts/studio/src/__tests__/Workspace.test.tsx',
     '''              lng: -104.99,
              capacity: null,
              status: "active",''',
     '''              lng: -104.99,
              // SCU-2.P4.10 (B2.8) — the modal derives the display code and,
              // under capacityMode "none", omits `capacity` (was null inline).
              displayCode: "WH-CO-DENVER-01",
              status: "active",'''),
    ('artifacts/studio/src/__tests__/Workspace.Brazil.test.tsx',
     '''    expect(screen.queryByTestId("tab-content-placeholder")).not.toBeInTheDocument();
    expect(screen.getByTestId("button-export-warehouses-csv")).toBeInTheDocument();
    expect(screen.getByTestId("button-import-warehouses")).toBeInTheDocument();''',
     '''    expect(screen.queryByTestId("tab-content-placeholder")).not.toBeInTheDocument();
    expect(screen.getByTestId("button-download-warehouses")).toBeInTheDocument();
    expect(screen.getByTestId("button-import-warehouses")).toBeInTheDocument();'''),
    ('artifacts/studio/src/pages/Workspace.tsx',
     '''          // jade-INT (#9, spec §10 D2 "JADE-first") — opt-in FilterMenu,
          // true only on the JADE path; every other model sharing this
          // branch (p-median-us/brazil/Chen/delivery-teaching-us) keeps the
          // default `false`.
          enableFilters={modelId === "two-echelon-jade-us"}
          // chen-bands-units follow-up (QA defect) — decision 1h's "ordinary''',
     '''          // jade-INT (#9) — JADE-only FilterMenu on the ImportDialog preview
          // grids. SCU-2.P4.10 (B2.2): the table's own FilterMenu now shows on
          // every model above 10 rows and no longer reads this.
          enableFilters={modelId === "two-echelon-jade-us"}
          modelId={modelId}
          // chen-bands-units follow-up (QA defect) — decision 1h's "ordinary'''),
    ('artifacts/studio/src/pages/Workspace.tsx',
     '''          entity="refineries"
''',
     '''          entity="refineries"
          modelId={modelId}
'''),
]
for path, old, new in EDITS:
    f = pathlib.Path(path)
    s = f.read_text()
    n = s.count(old)
    if n != 1:
        raise SystemExit(f'STOP: {path}: anchor found {n} times (expected 1): {old[:80]!r}')
    f.write_text(s.replace(old, new, 1))
print(f'applied {len(EDITS)} edits')
PY
```

- [ ] **Step 7: Run the task's tests**

Run: `pnpm --filter studio exec vitest run src/__tests__/WarehousesTab.dataTable.test.tsx src/__tests__/WarehousesTab.test.tsx src/__tests__/Workspace.Analytics.test.tsx src/__tests__/Workspace.Brazil.test.tsx src/__tests__/Workspace.TwoEchelon.test.tsx src/__tests__/Workspace.test.tsx src/__tests__/historyReadOnlyTabs.test.ts`
Expected: PASS — 280 tests in 7 files (measured at plan time). Then `pnpm --filter studio typecheck` → exit 0.

- [ ] **Step 8: e2e sweep, rewrites and local run**

Sweep (matrix §3 prefixes for this instance; `labs.spec.ts` excluded):
```bash
grep -rn -E 'warehouses-tab|refineries-tab|added-warehouses-|row-added-warehouse-|button-add-warehouse-|input-new-warehouse-|add-warehouse-row-form|button-export-warehouses|button-import-warehouses|button-wh-|input-wh-capacity-' artifacts/studio/e2e --include='*.ts' | grep -v labs.spec.ts
```
Rewritten below: `button-export-warehouses-csv` visibility, the 26-row "no FilterMenu" assert (now exactly one, in the toolbar — by design), both inline add forms → modal, JADE's add-form capacity check. Unchanged and still valid: `warehouses-tab(-toolbar)` (toolbar height < 40 asserted — Upload ▾, Download ▾, + Add, Filter fit one row), `added-warehouses-section`, `row-added-warehouse-*`, `button-add-warehouse-row` (incl. Refineries, D4), `button-wh-*` (JADE's 25 rows on one page), `checkbox-filter-status-Fixed-Open`, `text-filter-count` "25 of 25" (no added rows in that test), `thead th` without "Capacity".

Apply the rewrites (each anchor is asserted unique; verified against the Bundle 1 tip `e2e/` tree and type-checked at plan time):

```bash
python3 - <<'PY'
import pathlib
EDITS = [
    ('artifacts/studio/e2e/workspace-fixups.spec.ts',
     '''      await expect(page.getByTestId("button-export-warehouses-csv")).toBeVisible();''',
     '''      // SCU-2.P4.10 (B2.4) — Download ▾ trigger (the CSV id is now its menu item).
      await expect(page.getByTestId("button-download-warehouses")).toBeVisible();'''),
    ('artifacts/studio/e2e/workspace-fixups-2.spec.ts',
     '''      // ── Item 3 (non-JADE half) — no FilterMenu anywhere on this tab,
      // even though it has 26 > 10 rows. ──────────────────────────────────
      await expect(page.locator('[data-testid="warehouses-tab"] [data-testid="button-filter-menu-trigger"]')).toHaveCount(0);

      await page.getByTestId("button-add-warehouse-row").click();
      await page.getByTestId("input-new-warehouse-city").fill("Testburg");
      await page.getByTestId("input-new-warehouse-state").fill("ZZ");
      await page.getByTestId("input-new-warehouse-lat").fill("40.5");
      await page.getByTestId("input-new-warehouse-lng").fill("-75.2");
      await page.getByTestId("button-add-warehouse-confirm").click();''',
     '''      // ── SCU-2.P4.10 (spec B2.2, by design) — the FilterMenu now shows on
      // EVERY model above 10 rows, so this 26-row non-JADE tab has exactly one,
      // in the toolbar (it used to assert none). ─────────────────────────────
      await expect(page.locator('[data-testid="warehouses-tab-toolbar"] [data-testid="button-filter-menu-trigger"]')).toHaveCount(1);

      // SCU-2.P4.10 (B2.8) — "+ Add warehouse" opens the CreateEntityDialog modal.
      await page.getByTestId("button-add-warehouse-row").click();
      await expect(page.getByTestId("create-entity-dialog")).toBeVisible({ timeout: HEADER_TIMEOUT });
      await page.getByTestId("create-entity-city").fill("Testburg");
      await page.getByTestId("create-entity-state").fill("ZZ");
      await page.getByTestId("create-entity-lat").fill("40.5");
      await page.getByTestId("create-entity-lng").fill("-75.2");
      await page.getByTestId("create-entity-submit").click();
      await expect(page.getByTestId("create-entity-dialog")).toHaveCount(0, { timeout: HEADER_TIMEOUT });'''),
    ('artifacts/studio/e2e/jade-ch9-workspace-bundle.spec.ts',
     '''      // The "Add warehouse" form also has no capacity field for JADE.
      await page.getByTestId("button-add-warehouse-row").click();
      await expect(page.getByTestId("add-warehouse-row-form")).toBeVisible();
      await expect(page.getByTestId("input-new-warehouse-capacity")).toHaveCount(0);
      await page.getByTestId("button-add-warehouse-cancel").click();''',
     '''      // The "+ Add warehouse" modal (SCU-2.P4.10, B2.8) also has no capacity field for JADE.
      await page.getByTestId("button-add-warehouse-row").click();
      await expect(page.getByTestId("create-entity-dialog")).toBeVisible();
      await expect(page.getByTestId("create-entity-capacity")).toHaveCount(0);
      await page.getByTestId("create-entity-cancel").click();
      await expect(page.getByTestId("create-entity-dialog")).toHaveCount(0);'''),
]
for path, old, new in EDITS:
    f = pathlib.Path(path)
    s = f.read_text()
    n = s.count(old)
    if n != 1:
        raise SystemExit(f'STOP: {path}: anchor found {n} times (expected 1): {old[:80]!r}')
    f.write_text(s.replace(old, new, 1))
print(f'applied {len(EDITS)} edits')
PY
```

Then `pnpm --filter studio typecheck:e2e` (exit 0) and, with both local servers up (Global Constraints), run
```bash
cd artifacts/studio && E2E_BASE_URL=http://localhost:5179 npx playwright test e2e/workspace-fixups.spec.ts e2e/workspace-fixups-2.spec.ts e2e/jade-ch9-workspace-bundle.spec.ts e2e/tab-coverage.spec.ts e2e/delivery-teaching.spec.ts e2e/bundle6-ui-tweaks.spec.ts
```
Expected: every test passes (a failure → flake registry by test name, two isolated re-runs, before calling it a regression). Record per-spec pass/fail in the changelog entry.

- [ ] **Step 9: Gate**

Run each separately (Global Constraints):
1. `cnt=$(ps aux | grep "[v]itest" | grep -v "zsh -c" | wc -l | tr -d ' '); [ "$cnt" = "0" ]`
2. `pnpm run typecheck`
3. `pnpm --filter studio typecheck:e2e`
4. `DATABASE_URL="postgresql://shubhamkr@localhost:5432/nos_dev" pnpm --filter api-server test`
5. `pnpm --filter studio test`
6. `(cd artifacts/api-server/src/solver && python3 -m pytest tests/ -x)`
7. `pnpm --filter @workspace/import-schema test`

Expected: every command exits 0. Then `git diff --stat "$P3_TIP"..HEAD -- artifacts/api-server lib/db lib/api-spec` prints nothing.

- [ ] **Step 10: Changelog**

Append to the bottom of `docs/CHANGELOG-implementation.md`:

```markdown

### SCU-2.P4.10 — Warehouses + Refineries on DataTable with the +Add modal

- Warehouses + Refineries on DataTable: base + added sections, one FilterMenu on every model (was JADE-only), pager > 50, Upload ▾/Download ▾ + expected fields, "+ Add" modal (D4 id kept), D2 read-only on base AND added controls, numbers centred.
- New `entityCells.tsx` (StatusToggle, DeleteRowButton, DraftNumberInput). Legacy `WarehouseTable` no longer rendered by the Workspace (Studio.tsx keeps it).
- By design: `workspace-fixups-2.spec.ts` now asserts one FilterMenu on the 26-row non-JADE tab.
- Deviations 1, 3, 9, 13, 14, 15, 17, 18.
- Gate: studio <N passed>, api-server <N passed>, pytest <N passed>, import-schema <N passed>. e2e (local, `E2E_BASE_URL` set): <spec: pass/fail per spec>.
```

Replace each `<…>` with the value measured in this run, or the literal `unknown`.

- [ ] **Step 11: Commit**

```bash
git add artifacts/studio/src/components/data-table/entityCells.tsx artifacts/studio/src/__tests__/WarehousesTab.dataTable.test.tsx
```

```bash
[ "$(git rev-parse --abbrev-ref HEAD)" != "main" ] || exit 1
```

```bash
git commit artifacts/studio/src/components/data-table/entityCells.tsx artifacts/studio/src/__tests__/WarehousesTab.dataTable.test.tsx artifacts/studio/src/components/workspace/tabs/WarehousesTab.tsx artifacts/studio/src/__tests__/WarehousesTab.test.tsx artifacts/studio/src/__tests__/Workspace.Analytics.test.tsx artifacts/studio/src/__tests__/Workspace.TwoEchelon.test.tsx artifacts/studio/src/__tests__/Workspace.test.tsx artifacts/studio/src/__tests__/Workspace.Brazil.test.tsx artifacts/studio/src/pages/Workspace.tsx artifacts/studio/e2e/workspace-fixups.spec.ts artifacts/studio/e2e/workspace-fixups-2.spec.ts artifacts/studio/e2e/jade-ch9-workspace-bundle.spec.ts docs/CHANGELOG-implementation.md -m "[SCU-2.P4.10] move Warehouses and Refineries onto DataTable with the add modal" -m "Base+added sections, one FilterMenu on all models, Upload/Download menus, +Add modal (D4 id kept), D2 read-only on added controls. One commit for #17-#20 (dev 1). Deviations 1, 3, 9, 13-15, 17, 18." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task SCU-2.P4.11: Customers (scalar + JADE per-product) on DataTable with the demand cell and the +Add modal

**Owner role:** frontend-engineer. **Matrix:** §1 #21–#24, §2c Customers + JADE per-product base/added. **Spec:** B2.1–B2.4, B2.8, B2.9, D2, D3; user decisions 2026-10-17. **Deviations:** 1, 2, 3, 9, 10, 11, 13, 14, 15, 17, 18.

**Files:**
- Create: `artifacts/studio/src/__tests__/CustomersTab.dataTable.test.tsx`
- Modify: `artifacts/studio/src/components/workspace/tabs/CustomersTab.tsx`
- Modify: `artifacts/studio/src/__tests__/CustomersTab.test.tsx`
- Modify: `artifacts/studio/src/components/data-table/entityCells.tsx`
- Modify: `artifacts/studio/src/__tests__/Workspace.test.tsx`
- Modify: `artifacts/studio/src/__tests__/Workspace.Brazil.test.tsx`
- Modify: `artifacts/studio/src/pages/Workspace.tsx`
- Modify: `artifacts/studio/e2e/import.spec.ts`
- Modify: `artifacts/studio/e2e/max-coverage.spec.ts`
- Modify: `artifacts/studio/e2e/chen-bands-units-qa.spec.ts`
- Modify: `artifacts/studio/e2e/jade-two-echelon.spec.ts`
- Modify: `docs/CHANGELOG-implementation.md` (append `### SCU-2.P4.11`)

**Interfaces:**
- Consumes: P4.10 `entityCells`; P1 `FormattedNumberInput`; P4.2 modal (`products` for JADE); `completenessCountForCustomer`, `idCollisionMessageForCustomer` (unchanged).
- Produces: `DemandCell` (appended to `entityCells.tsx`); `CustomersTab` prop `modelId?`; new pager ids `button-customers-prev/next`, `customers-page-indicator`.

**Behaviour changes (record each in the changelog):**
- Every demand cell (base, added, JADE per-product) is a grouped `FormattedNumberInput` with a linked "Units" suffix, no aria-label; emptying a base demand clears the override (base value back on blur); emptying an added demand saves nothing (last value back on blur) — it used to commit 0.
- JADE base + added per-product controls and status are disabled while browsing history (D2 — they were live); added scalar controls too.
- FilterMenu on every model above 10 rows over base + added (was JADE-only); Customers' state stays a text filter.
- "+ Add customer" opens the modal; an empty demand (incl. JADE per-product) blocks submit.
- Upload ▾ / Download ▾; pager above 50 rows; numbers centred.

- [ ] **Step 0: Invoke the simplicity skills**

Skill tool: `andrej-karpathy-skills:karpathy-guidelines`, then `ponytail:ponytail`. Record in the report that both ran (hard rule #12).

- [ ] **Step 1: Preconditions**

Run each line alone (worktree root):
```bash
cd /Users/shubhamkr/nos-scu-2.p4.11 && git rev-parse --abbrev-ref HEAD
git merge-base --is-ancestor "$BASE" HEAD || exit 1
git merge-base --is-ancestor "$B1_TIP" HEAD || exit 1
git merge-base --is-ancestor "$P3_TIP" HEAD || exit 1
test -f artifacts/studio/src/components/data-table/DataTable.tsx && test -f artifacts/studio/src/components/data-table/DownloadMenu.tsx && test -d lib/import-schema || exit 1
pnpm install --frozen-lockfile
```
Then confirm the files this task replaces wholesale are still the `46d2f98` text (Global Constraints):
```bash
git diff --quiet 46d2f98 HEAD -- artifacts/studio/src/components/workspace/tabs/CustomersTab.tsx || { echo 'STOP: artifacts/studio/src/components/workspace/tabs/CustomersTab.tsx changed since 46d2f98'; exit 1; }
```

- [ ] **Step 2: Write the failing test**

Create `artifacts/studio/src/__tests__/CustomersTab.dataTable.test.tsx`:

```bash
mkdir -p artifacts/studio/src/__tests__ && cat > artifacts/studio/src/__tests__/CustomersTab.dataTable.test.tsx <<'SCU_EOF'
// SCU-2.P4.11 — Customers (scalar + JADE per-product) on the shared DataTable
// with the B2.9 demand cell (spec B2.1–B2.4, B2.8, B2.9, D2, D3 and the
// 2026-10-17 user decisions): grouped demand with a linked "Units" suffix and
// no aria-label; empty base demand clears the override; empty ADDED demand is
// not saved and reverts on blur; the Brazil lock is base-only; history
// read-only covers base, added and JADE rows; one filter menu over base +
// added; empty demand blocks the add-customer submit.

import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { AllProviders } from "@/__tests__/helpers/renderWithExportProvider";
import { CustomersTab, type AddedCustomer, type CustomerProductOverride } from "@/components/workspace/tabs/CustomersTab";
import type { CustomerOverride } from "@/components/tables/CustomerTable";

const customers = Array.from({ length: 10 }, (_, i) => ({ id: `C${i + 1}`, city: `City${i + 1}`, state: "NY", lat: 40 + i, lng: -74 - i, demand: 1000 * (i + 1) + 234 }));
const added: AddedCustomer[] = [{ id: "ac-1", city: "Denver", state: "CO", lat: 39.7, lng: -105, demand: 5000, displayCode: "CS-CO-DENVER-01" }];
const products = [
  { id: "product-1", name: "Copper" },
  { id: "product-2", name: "Aluminum" },
];
const jadeCustomers = customers.map(c => ({ ...c, demands: { "product-1": 1200, "product-2": 30 } }));
const jadeAdded: AddedCustomer[] = [{ ...added[0]!, demand: 50, demands: { "product-1": 40, "product-2": 10 } }];

const renderTab = (props: Partial<React.ComponentProps<typeof CustomersTab>> = {}) =>
  render(
    <CustomersTab
      customers={customers}
      overrides={[]}
      onChange={vi.fn()}
      scenarioId={1}
      addedCustomers={added}
      onAddedCustomersChange={vi.fn()}
      onDeleteCustomer={vi.fn()}
      {...props}
    />,
    { wrapper: AllProviders },
  );

const describedSuffix = (input: HTMLElement) => document.getElementById(input.getAttribute("aria-describedby") ?? "");

describe("CustomersTab on DataTable (SCU-2.P4.11)", () => {
  it("emits every testid in the matrix map (scalar)", () => {
    renderTab();
    for (const id of [
      "customers-tab",
      "customers-tab-toolbar",
      "button-import-customers",
      "button-download-customers",
      "button-filter-menu-trigger",
      "button-add-customer-row",
      "input-customer-demand-C1",
      "button-customer-C1-active",
      "button-customer-C1-excluded",
      "added-customers-section",
      "row-added-customer-ac-1",
      "input-added-customer-demand-ac-1",
      "button-delete-added-customer-ac-1",
    ]) {
      expect(screen.getByTestId(id)).toBeInTheDocument();
    }
    expect(screen.queryByTestId("customer-product-table")).toBeNull();
  });

  it("B2.9: demand is grouped, has a linked Units suffix and NO aria-label (base and added)", () => {
    renderTab();
    for (const id of ["input-customer-demand-C1", "input-added-customer-demand-ac-1"]) {
      const input = screen.getByTestId(id);
      expect(input).toHaveAttribute("type", "text");
      expect(input).not.toHaveAttribute("aria-label");
      expect(describedSuffix(input)).toHaveTextContent("Units");
    }
    expect(screen.getByTestId("input-customer-demand-C1")).toHaveValue("1,234");
    expect(screen.getByTestId("input-added-customer-demand-ac-1")).toHaveValue("5,000");
  });

  it("D3: emptying a BASE demand clears the override; the base value returns on blur", () => {
    function Parent() {
      const [o, setO] = useState<CustomerOverride[]>([{ id: "C1", demand: 777, status: "active" }]);
      return (
        <>
          <CustomersTab customers={customers} overrides={o} onChange={setO} />
          <output data-testid="overrides">{JSON.stringify(o)}</output>
        </>
      );
    }
    render(<Parent />, { wrapper: AllProviders });
    const input = screen.getByTestId("input-customer-demand-C1");
    expect(input).toHaveValue("777");
    fireEvent.change(input, { target: { value: "" } });
    expect(screen.getByTestId("overrides")).toHaveTextContent("[]");
    expect(screen.getByTestId("input-customer-demand-C1")).toHaveValue("");
    fireEvent.blur(screen.getByTestId("input-customer-demand-C1"));
    expect(screen.getByTestId("input-customer-demand-C1")).toHaveValue("1,234");
  });

  it("an emptied ADDED demand is NOT saved and reverts to the last valid value on blur", () => {
    const onAdded = vi.fn();
    renderTab({ onAddedCustomersChange: onAdded });
    const input = screen.getByTestId("input-added-customer-demand-ac-1");
    fireEvent.change(input, { target: { value: "" } });
    expect(onAdded).not.toHaveBeenCalled();
    expect(input).toHaveValue("");
    fireEvent.blur(input);
    expect(screen.getByTestId("input-added-customer-demand-ac-1")).toHaveValue("5,000");
  });

  it("a typed demand commits (decimals allowed, D3) through a stateful parent", () => {
    function Parent() {
      const [a, setA] = useState<AddedCustomer[]>(added);
      return <CustomersTab customers={customers} overrides={[]} onChange={vi.fn()} addedCustomers={a} onAddedCustomersChange={setA} onDeleteCustomer={vi.fn()} />;
    }
    render(<Parent />, { wrapper: AllProviders });
    fireEvent.change(screen.getByTestId("input-added-customer-demand-ac-1"), { target: { value: "12345.5" } });
    expect(screen.getByTestId("input-added-customer-demand-ac-1")).toHaveValue("12,345.5");
  });

  it("Brazil (demandEditable false): BASE demand locked with the textbook title, ADDED demand editable", () => {
    renderTab({ demandEditable: false });
    expect(screen.getByTestId("input-customer-demand-C1")).toBeDisabled();
    expect(screen.getByTestId("input-customer-demand-C1")).toHaveAttribute("title", "Demand for this row is fixed by the textbook dataset and can't be edited.");
    expect(screen.getByTestId("button-customer-C1-excluded")).toBeEnabled();
    expect(screen.getByTestId("input-added-customer-demand-ac-1")).toBeEnabled();
  });

  it("history read-only (D2): base demand + status, added demand + delete, and the add trigger are disabled", () => {
    renderTab({ disabled: true });
    for (const id of ["input-customer-demand-C1", "button-customer-C1-excluded", "input-added-customer-demand-ac-1", "button-delete-added-customer-ac-1", "button-add-customer-row"]) {
      expect(screen.getByTestId(id)).toBeDisabled();
    }
    expect(screen.getByTestId("input-customer-demand-C1")).toHaveAttribute("title", "Read-only while browsing result history.");
  });

  it("ONE filter menu over base + added (11 rows), Customers' state stays a text filter", () => {
    renderTab();
    expect(screen.getAllByTestId("button-filter-menu-trigger")).toHaveLength(1);
    fireEvent.click(screen.getByTestId("button-filter-menu-trigger"));
    expect(screen.getByTestId("input-filter-state")).toBeInTheDocument();
    fireEvent.change(screen.getByTestId("input-filter-city"), { target: { value: "denver" } });
    expect(screen.getByTestId("row-added-customer-ac-1")).toBeInTheDocument();
    expect(screen.queryByTestId("input-customer-demand-C1")).toBeNull();
  });

  it("the add modal blocks an EMPTY scalar demand; a filled one appends", () => {
    const onAdded = vi.fn();
    renderTab({ onAddedCustomersChange: onAdded });
    fireEvent.click(screen.getByTestId("button-add-customer-row"));
    const d = screen.getByTestId("create-entity-dialog");
    for (const [id, v] of [["create-entity-city", "Akron"], ["create-entity-state", "OH"], ["create-entity-lat", "41.08"], ["create-entity-lng", "-81.52"]] as const) {
      fireEvent.change(within(d).getByTestId(id), { target: { value: v } });
    }
    fireEvent.click(within(d).getByTestId("create-entity-submit"));
    expect(within(d).getByTestId("create-entity-error")).toHaveTextContent("Demand must be a number ≥ 0.");
    expect(onAdded).not.toHaveBeenCalled();
    fireEvent.change(within(d).getByTestId("create-entity-demand"), { target: { value: "205375" } });
    fireEvent.click(within(d).getByTestId("create-entity-submit"));
    expect(onAdded).toHaveBeenCalledTimes(1);
    expect((onAdded.mock.calls[0]![0] as AddedCustomer[])[1]).toMatchObject({ city: "Akron", demand: 205375, displayCode: "CS-OH-AKRON-01" });
  });
});

describe("CustomersTab JADE per-product on DataTable (SCU-2.P4.11)", () => {
  const renderJade = (props: Partial<React.ComponentProps<typeof CustomersTab>> = {}) =>
    render(
      <CustomersTab
        customers={jadeCustomers}
        overrides={[]}
        onChange={vi.fn()}
        products={products}
        productOverrides={[]}
        onProductOverridesChange={vi.fn()}
        addedCustomers={jadeAdded}
        onAddedCustomersChange={vi.fn()}
        onDeleteCustomer={vi.fn()}
        {...props}
      />,
      { wrapper: AllProviders },
    );

  it("emits the JADE testids: wrapper, per-product base and added demand, status", () => {
    renderJade();
    for (const id of [
      "customer-product-table",
      "input-customer-demand-C1-product-1",
      "input-customer-demand-C1-product-2",
      "button-customer-C1-excluded",
      "input-added-customer-demand-ac-1-product-1",
      "row-added-customer-ac-1",
    ]) {
      expect(screen.getByTestId(id)).toBeInTheDocument();
    }
    expect(screen.getByTestId("input-customer-demand-C1-product-1")).toHaveValue("1,200");
    expect(screen.getByTestId("input-customer-demand-C1-product-1")).not.toHaveAttribute("aria-label");
    expect(describedSuffix(screen.getByTestId("input-customer-demand-C1-product-1"))).toHaveTextContent("Units");
    // the base table's headers: one demand column per product, State always shown
    const baseHeaders = within(screen.getByTestId("customer-product-table")).getAllByRole("columnheader").map(h => h.textContent);
    expect(baseHeaders).toEqual(["ID", "City", "State", "Latitude", "Longitude", "Copper", "Aluminum", "Status"]);
  });

  it("history read-only (D2) now covers JADE base AND added per-product demand + status (was live)", () => {
    renderJade({ disabled: true });
    for (const id of ["input-customer-demand-C1-product-1", "button-customer-C1-excluded", "input-added-customer-demand-ac-1-product-2", "button-delete-added-customer-ac-1"]) {
      expect(screen.getByTestId(id)).toBeDisabled();
    }
  });

  it("emptying a JADE base product demand deletes that product's override (D3)", () => {
    function Parent() {
      const [o, setO] = useState<CustomerProductOverride[]>([{ id: "C1", status: "active", demands: { "product-1": 5, "product-2": 6 } }]);
      return (
        <>
          <CustomersTab customers={jadeCustomers} overrides={[]} onChange={vi.fn()} products={products} productOverrides={o} onProductOverridesChange={setO} />
          <output data-testid="overrides">{JSON.stringify(o)}</output>
        </>
      );
    }
    render(<Parent />, { wrapper: AllProviders });
    fireEvent.change(screen.getByTestId("input-customer-demand-C1-product-1"), { target: { value: "" } });
    expect(JSON.parse(screen.getByTestId("overrides").textContent ?? "")).toEqual([{ id: "C1", status: "active", demands: { "product-2": 6 } }]);
    fireEvent.blur(screen.getByTestId("input-customer-demand-C1-product-1"));
    expect(screen.getByTestId("input-customer-demand-C1-product-1")).toHaveValue("1,200");
  });

  it("an emptied JADE ADDED product demand is not saved and reverts on blur", () => {
    const onAdded = vi.fn();
    renderJade({ onAddedCustomersChange: onAdded });
    const input = screen.getByTestId("input-added-customer-demand-ac-1-product-1");
    fireEvent.change(input, { target: { value: "" } });
    expect(onAdded).not.toHaveBeenCalled();
    fireEvent.blur(input);
    expect(screen.getByTestId("input-added-customer-demand-ac-1-product-1")).toHaveValue("40");
  });
});
SCU_EOF
```

- [ ] **Step 3: Run it to verify it fails**

Run: `pnpm --filter studio exec vitest run src/__tests__/CustomersTab.dataTable.test.tsx`
Expected: FAIL — `Tests  12 failed | 1 passed (13)` (measured at plan time against the pre-migration tab) — `CustomersTab.dataTable.test.tsx` fails — demand inputs are `type=number` without grouping or Units, JADE rows not disabled in history, no modal, no shared filter over added rows.

- [ ] **Step 4: Implement — `CustomersTab.tsx`**

Replace the whole file `artifacts/studio/src/components/workspace/tabs/CustomersTab.tsx` with:

```bash
mkdir -p artifacts/studio/src/components/workspace/tabs && cat > artifacts/studio/src/components/workspace/tabs/CustomersTab.tsx <<'SCU_EOF'
import { useState } from "react";
import type { Customer, Product, Scenario } from "@workspace/api-client-react";
import type { CustomerOverride } from "@/components/tables/CustomerTable";
import { Button } from "@/components/ui/button";
import { AlertTriangle } from "lucide-react";
import { completenessCountForCustomer, idCollisionMessageForCustomer, type PrecheckErrorLike } from "@/lib/precheckDisplay";
import { CreateEntityDialog } from "@/components/workspace/map/dialogs/CreateEntityDialog";
import { DataTable } from "@/components/data-table/DataTable";
import type { ColumnDef } from "@/components/data-table/types";
import { useEntityFileMenus } from "@/components/data-table/useEntityFileMenus";
import { DeleteRowButton, DemandCell, READ_ONLY_TITLE, StatusToggle } from "@/components/data-table/entityCells";

// B5.2 — matches `addedCustomerSchema` in
// artifacts/api-server/src/validation/inputs/pMedian.ts exactly (server-side
// source of truth for this shape). No `status` field — precheck.ts's own
// comment: "v1 has no way to add a customer and mark it excluded in the
// same breath" — every added customer counts as active, always.
//
// T11 (Chapter 9 JADE) — a parallel `demands` (per-product,
// `{productId: tons}`) is added, matching `jadeInputsSchema`'s
// `addedCustomers[].demands` (T5) exactly. `demand` STAYS required (not
// widened to optional) — it's a load-bearing field for other consumers of
// this exact exported type (e.g. `Workspace.tsx`'s `addedCustomersFromInputs`
// feeds `OutputMapTab.tsx`'s `EffectiveAddedCustomer`, which also requires a
// numeric `demand` for customer-bubble sizing); making it optional here would
// silently break that unrelated consumer's typecheck. For a JADE added
// customer, this component computes `demand` as the sum of `demands`' values
// — the exact same "scalar total = Σ of the 4 products" convention the base
// `Customer.demand`/`demands` fields already document (openapi.yaml).
export interface AddedCustomer {
  id: string;
  city: string;
  state: string;
  lat: number;
  lng: number;
  demand: number;
  /** T11 — Chapter 9 JADE per-product demand breakdown, keyed by product id. Always kept in sync with `demand` (its sum) when present. */
  demands?: Record<string, number>;
  /** T9 — grid-mirror's auto-computed cosmetic label (T3's nextDisplayCode), same optional field CreateEntityDialog's map-click flow already writes. */
  displayCode?: string;
}

// T11 — Chapter 9 JADE's per-product customer override, parallel to
// `CustomerOverride` (CustomerTable.tsx) which only carries a scalar
// `demand`. Matches `jadeInputsSchema`'s `customerOverrides[]` shape
// (`{id, demands?: Record<productId, tons>, status}`) exactly. Kept as its
// own type/prop pair (`productOverrides`/`onProductOverridesChange`) rather
// than widening `CustomerOverride` itself, so every non-JADE caller
// (p-median-us, two-echelon-gold-au) stays byte-identical to before this
// task.
export interface CustomerProductOverride {
  id: string;
  demands?: Record<string, number>;
  status: "active" | "excluded";
}

interface CustomersTabProps {
  customers: Customer[];
  overrides: CustomerOverride[];
  onChange: (next: CustomerOverride[]) => void;
  /** Undefined while the scenario hasn't resolved yet — Upload/Download stay disabled until it has. */
  scenarioId?: number;
  /** Fired after a successful import apply, with the updated scenario — the caller (Workspace.tsx) refreshes its inputs draft from it. */
  onImportApplied?: (scenario: Scenario) => void;
  /** B5.2 — scenario-local addedCustomers (B1.1), p-median-us only (two-echelon-gold-au's CustomersTab call site omits these props — its own inputs schema has no addedCustomers field). */
  addedCustomers?: AddedCustomer[];
  /** Fired on both add (append) and in-row edits (demand) — full replacement array, same `onChange`-out convention as every other tab. */
  onAddedCustomersChange?: (next: AddedCustomer[]) => void;
  /** Fired on delete only — kept separate from onAddedCustomersChange because the caller (Workspace.tsx) also needs to purge any distanceOverrides referencing this id in the SAME atomic inputs update. */
  onDeleteCustomer?: (id: string) => void;
  /** B2.1's precheck errors for the current scenario — drives the inline "missing N distances" chip on added rows. */
  precheckErrors?: PrecheckErrorLike[];
  /** T5 (Bundle 2, Step 2b) — threaded straight through to CustomerTable
   * (see its own comment); the "Added customers" section below is NEVER
   * gated by this — an added region has no textbook demand to protect.
   * Defaults true, unaffected for every existing caller. */
  demandEditable?: boolean;
  /** T11 (Chapter 9 JADE) — presence (non-empty array) is what switches this
   * whole component into per-product demand mode: base rows render one
   * demand column per product instead of `CustomerTable`'s single scalar
   * Demand column, and the "Added customers" section does the same. Every
   * existing model (p-median-us, two-echelon-gold-au, transport-coal,
   * p-median-brazil) omits this prop entirely and is completely unaffected
   * — gated on the data's presence, never `modelId ===` (Gate 6). */
  products?: Product[];
  /** T11 — sparse per-customer per-product demand + active/excluded
   * overrides, parallel to `overrides`/`onChange` (scalar-demand models).
   * Required (with `products`) to actually render the per-product base
   * table; without it, base rows fall back to the scalar `CustomerTable`
   * even if `products` happens to be set (defensive — mirrors every other
   * tab's "gate on the actual wired capability" fix). */
  productOverrides?: CustomerProductOverride[];
  onProductOverridesChange?: (next: CustomerProductOverride[]) => void;
  /** Chen's Cosmetics (max-coverage-us) has no state data — every row's `state` is "". Gate on DATA PRESENCE (Workspace.tsx computes this from the resolved dataset), not modelId — drops the State column from the base table and the Added-customers table, and drops the state-required check from the add-row form. Defaults true (every other model has real state data and is unaffected). */
  hasStateColumn?: boolean;
  /** B7 (JADE) — now only the ImportDialog preview grids' FilterMenu opt-in.
   * SCU-2.P4.11 (B2.2): the table's own FilterMenu shows on every model
   * above 10 rows (base + added rows, one menu), so it no longer reads this. */
  enableFilters?: boolean;
  /** SCU-2.P4.11 — narrows the Upload/Download expected-fields panel. */
  modelId?: string;
  /** History read-only (decision 1h; SCU-2.P4.11 D2): every demand input,
   * status button, delete button and the "+ Add customer" trigger — base,
   * added and JADE per-product rows alike — is disabled. Defaults false. */
  disabled?: boolean;
}

/** One effective row: a base customer merged with its override, or an added customer. */
interface CustomerRow {
  id: string;
  displayId: string;
  city: string;
  state: string;
  lat: number;
  lng: number;
  zip?: string;
  /** Effective scalar demand (base: override ?? dataset; added: stored). */
  demand: number;
  /** JADE: effective per-product demand. */
  demands: Record<string, number>;
  status: "active" | "excluded";
  added: boolean;
}

const CUSTOMER_STATUSES = ["active", "excluded"] as const;
const customerStatusClass = (s: "active" | "excluded") =>
  s === "excluded" ? "bg-destructive text-white" : "bg-slate-200 text-foreground";
const BRAZIL_LOCK_TITLE = "Demand for this row is fixed by the textbook dataset and can't be edited.";

// A1.1 → SCU-2.P4.11 (spec B2.1–B2.4, B2.8, B2.9, D2) — Customers on the
// shared DataTable, scalar models and JADE (per-product demand, `productMode`)
// alike: base and added rows are two sections under ONE toolbar (Upload ▾,
// Download ▾, "+ Add customer" modal, one FilterMenu above 10 rows on every
// model) and one pager. Every demand cell is a FormattedNumberInput (grouped,
// "Units" suffix, no aria-label); history read-only covers base, added and
// JADE rows; the Brazil lock (`!demandEditable`) stays base-only. The legacy
// `CustomerTable` is no longer rendered here (Studio.tsx still uses it).
export function CustomersTab({
  customers,
  overrides,
  onChange,
  scenarioId,
  onImportApplied,
  addedCustomers = [],
  onAddedCustomersChange,
  onDeleteCustomer,
  precheckErrors = [],
  demandEditable = true,
  products = [],
  productOverrides = [],
  onProductOverridesChange,
  hasStateColumn = true,
  enableFilters = false,
  disabled = false,
  modelId,
}: CustomersTabProps) {
  const files = useEntityFileMenus({
    entity: "customers",
    testIdEntity: "customers",
    modelId,
    scenarioId,
    onImportApplied,
    enableFilters,
  });
  const [adding, setAdding] = useState(false);
  // T11 (JADE) — per-product mode needs both the products AND the per-product override channel.
  const productMode = products.length > 0 && onProductOverridesChange != null;
  // JADE's base table always shows State (unchanged); scalar models follow hasStateColumn.
  const showState = productMode || hasStateColumn;

  function upsertScalar(id: string, patch: Partial<CustomerOverride>) {
    if (disabled) return;
    const existing = overrides.find(o => o.id === id);
    const merged: CustomerOverride = { id, status: existing?.status ?? "active", demand: existing?.demand, ...patch };
    const rest = overrides.filter(o => o.id !== id);
    onChange(merged.status === "active" && merged.demand == null ? rest : [...rest, merged]);
  }

  function upsertProduct(id: string, patch: Partial<CustomerProductOverride>) {
    if (disabled || !onProductOverridesChange) return;
    const existing = productOverrides.find(o => o.id === id);
    const merged: CustomerProductOverride = { id, status: existing?.status ?? "active", demands: existing?.demands, ...patch };
    const rest = productOverrides.filter(o => o.id !== id);
    const hasDemands = merged.demands != null && Object.keys(merged.demands).length > 0;
    onProductOverridesChange(merged.status === "active" && !hasDemands ? rest : [...rest, merged]);
  }

  /** JADE base per-product demand: null (emptied) deletes that product's override (D3). */
  function setProductDemand(customerId: string, productId: string, value: number | null) {
    const nextDemands = { ...(productOverrides.find(o => o.id === customerId)?.demands ?? {}) };
    if (value === null) delete nextDemands[productId];
    else nextDemands[productId] = value;
    upsertProduct(customerId, { demands: Object.keys(nextDemands).length ? nextDemands : undefined });
  }

  function upsertAdded(id: string, patch: (c: AddedCustomer) => AddedCustomer) {
    if (disabled) return;
    onAddedCustomersChange?.(addedCustomers.map(c => (c.id === id ? patch(c) : c)));
  }

  const rows: CustomerRow[] = [
    ...customers.map(c => {
      const scalar = overrides.find(o => o.id === c.id);
      const perProduct = productOverrides.find(o => o.id === c.id);
      const demands: Record<string, number> = {};
      for (const p of products) demands[p.id] = perProduct?.demands?.[p.id] ?? c.demands?.[p.id] ?? 0;
      return {
        id: c.id,
        displayId: c.id,
        city: c.city,
        state: c.state,
        lat: c.lat,
        lng: c.lng,
        zip: c.zip,
        demand: scalar?.demand ?? c.demand,
        demands,
        status: (productMode ? perProduct?.status : scalar?.status) ?? "active",
        added: false,
      };
    }),
    ...addedCustomers.map(c => ({
      id: c.id,
      displayId: c.displayCode ?? c.id,
      city: c.city,
      state: c.state,
      lat: c.lat,
      lng: c.lng,
      demand: c.demand,
      demands: Object.fromEntries(products.map(p => [p.id, c.demands?.[p.id] ?? 0])),
      status: "active" as const,
      added: true,
    })),
  ];

  // Rebuilt every render: cells close over live props (see DistancesTab).
  const idColumn = (added: boolean): ColumnDef<CustomerRow> => ({
    id: "id",
    header: "ID",
    kind: "text",
    filter: "text",
    value: r => r.displayId,
    cellClassName: "font-mono text-xs",
    cell: r => {
      if (!added) return r.displayId;
      const missing = completenessCountForCustomer(precheckErrors, r.id);
      const collision = idCollisionMessageForCustomer(precheckErrors, r.id);
      return (
        <div className="flex items-center gap-1">
          {r.displayId}
          {(missing > 0 || collision) && (
            <span
              title={
                collision ??
                `${missing} warehouse${missing === 1 ? " lacks" : "s lack"} a distance to this customer — see the Distances tab, or download/upload a template.`
              }
              data-testid={`warning-precheck-added-customer-${r.id}`}
              className="inline-flex items-center gap-0.5 text-[10px] text-amber-700 bg-amber-100 border border-amber-300 rounded px-1"
            >
              <AlertTriangle className="w-3 h-3" />
              {collision ? "ID collision" : `Missing ${missing} distance${missing === 1 ? "" : "s"}`}
            </span>
          )}
        </div>
      );
    },
  });
  const locationColumns = (added: boolean): ColumnDef<CustomerRow>[] => [
    idColumn(added),
    { id: "city", header: "City", kind: "text", filter: "text", value: r => r.city, cellClassName: "text-xs", cell: r => r.city },
    // Customers' State filter stays a TEXT filter (today's type), unlike Warehouses' select.
    ...((added ? hasStateColumn : showState)
      ? [
          {
            id: "state",
            header: "State",
            kind: "text",
            filter: "text",
            value: r => r.state || null,
            cellClassName: "text-xs",
            cell: r => r.state,
          } satisfies ColumnDef<CustomerRow>,
        ]
      : []),
    {
      id: "lat",
      header: "Latitude",
      kind: "number",
      value: r => r.lat,
      cellClassName: "text-xs font-mono",
      cell: r => r.lat.toFixed(4),
    },
    {
      id: "lng",
      header: "Longitude",
      kind: "number",
      value: r => r.lng,
      cellClassName: "text-xs font-mono",
      cell: r => r.lng.toFixed(4),
    },
  ];

  // Base demand: history disables it; the Brazil lock disables it on BASE rows only.
  const baseDemandTitle = disabled ? READ_ONLY_TITLE : demandEditable ? undefined : BRAZIL_LOCK_TITLE;
  const demandColumns = (added: boolean): ColumnDef<CustomerRow>[] =>
    productMode
      ? products.map(p => ({
          // Descriptor key `demand:{productId}` is today's JADE filter key.
          id: `demand:${p.id}`,
          header: p.name,
          kind: "number" as const,
          value: (r: CustomerRow) => r.demands[p.id] ?? 0,
          cell: (r: CustomerRow) => (
            <DemandCell
              suffix="Units"
              value={r.demands[p.id] ?? 0}
              clearCommits={!added}
              onCommit={v =>
                added
                  ? v !== null &&
                    upsertAdded(r.id, c => {
                      const demands = { ...(c.demands ?? {}), [p.id]: v };
                      return { ...c, demands, demand: Object.values(demands).reduce((sum, x) => sum + x, 0) };
                    })
                  : setProductDemand(r.id, p.id, v)
              }
              disabled={disabled}
              title={disabled ? READ_ONLY_TITLE : undefined}
              testId={added ? `input-added-customer-demand-${r.id}-${p.id}` : `input-customer-demand-${r.id}-${p.id}`}
            />
          ),
        }))
      : [
          {
            id: "demand",
            header: "Demand",
            kind: "number",
            value: r => r.demand,
            cell: r => (
              <DemandCell
                suffix="Units"
                value={r.demand}
                clearCommits={!added}
                onCommit={v =>
                  added ? v !== null && upsertAdded(r.id, c => ({ ...c, demand: v })) : upsertScalar(r.id, { demand: v })
                }
                disabled={disabled || (!added && !demandEditable)}
                title={added ? (disabled ? READ_ONLY_TITLE : undefined) : baseDemandTitle}
                testId={added ? `input-added-customer-demand-${r.id}` : `input-customer-demand-${r.id}`}
              />
            ),
          },
        ];

  const hasZip = !productMode && customers.some(c => c.zip);
  const baseColumns: ColumnDef<CustomerRow>[] = [
    ...locationColumns(false),
    ...(hasZip
      ? [
          {
            id: "zip",
            header: "Zip",
            kind: "text",
            filter: "text",
            value: r => r.zip ?? null,
            cellClassName: "text-xs font-mono",
            cell: r => r.zip ?? "—",
          } satisfies ColumnDef<CustomerRow>,
        ]
      : []),
    ...demandColumns(false),
    {
      id: "status",
      header: "Status",
      kind: "enum",
      value: r => (r.status === "active" ? "Active" : "Excluded"),
      cell: r => (
        <StatusToggle
          options={CUSTOMER_STATUSES}
          value={r.status}
          labelOf={s => (s === "active" ? "Active" : "Excluded")}
          activeClassOf={customerStatusClass}
          onChange={status => (productMode ? upsertProduct(r.id, { status }) : upsertScalar(r.id, { status }))}
          disabled={disabled}
          testIdOf={s => `button-customer-${r.id}-${s}`}
        />
      ),
    },
  ];
  const addedColumns: ColumnDef<CustomerRow>[] = [
    ...locationColumns(true),
    ...demandColumns(true),
    {
      id: "delete",
      header: "",
      kind: "text",
      filter: false,
      value: () => null,
      cell: r => (
        <DeleteRowButton
          label={`Delete added customer ${r.id}`}
          onClick={() => onDeleteCustomer?.(r.id)}
          disabled={disabled}
          testId={`button-delete-added-customer-${r.id}`}
        />
      ),
    },
  ];

  const addTrigger = onAddedCustomersChange != null && (
    <Button
      size="sm"
      variant="outline"
      className="h-7 px-2 text-xs"
      onClick={() => setAdding(true)}
      disabled={disabled}
      title={disabled ? READ_ONLY_TITLE : undefined}
      data-testid="button-add-customer-row"
    >
      + Add customer
    </Button>
  );

  return (
    <div data-testid="customers-tab">
      <DataTable<CustomerRow>
        rows={rows}
        rowKey={r => `${r.added ? "added" : "base"}:${r.id}`}
        columns={baseColumns}
        ctx={{ readOnly: disabled, demandEditable, isAdded: r => r.added }}
        testIds={{
          toolbar: "customers-tab-toolbar",
          pagerPrev: "button-customers-prev",
          pagerNext: "button-customers-next",
          pageIndicator: "customers-page-indicator",
        }}
        toolbar={{ upload: files.upload, download: files.download, add: addTrigger }}
        sections={[
          {
            id: "base",
            includes: r => !r.added,
            scrollClassName: "max-h-[60vh] overflow-y-auto",
            // JADE's per-product base table keeps its wrapper testid.
            scrollTestId: productMode ? "customer-product-table" : undefined,
            emptyState: (
              <p className="text-sm text-muted-foreground" data-testid="customers-tab-empty">
                No customers in this dataset.
              </p>
            ),
          },
          ...(onAddedCustomersChange != null
            ? [
                {
                  id: "added",
                  title: "Added customers",
                  testId: "added-customers-section",
                  includes: (r: CustomerRow) => r.added,
                  columns: addedColumns,
                  rowTestId: (r: CustomerRow) => `row-added-customer-${r.id}`,
                  scrollClassName: "max-h-[40vh] overflow-y-auto",
                  emptyState: (
                    <p className="text-xs text-muted-foreground" data-testid="added-customers-empty">
                      No added customers yet — use "+ Add customer" above to create one.
                    </p>
                  ),
                },
              ]
            : []),
        ]}
      />
      {adding && (
        <CreateEntityDialog
          source="table"
          entityKind="customer"
          hasStateColumn={hasStateColumn}
          products={productMode ? products : undefined}
          existingCodes={addedCustomers.map(c => c.displayCode).filter((c): c is string => !!c)}
          onCreate={r => {
            if (r.kind === "customer") onAddedCustomersChange?.([...addedCustomers, r.entity]);
            setAdding(false);
          }}
          onCancel={() => setAdding(false)}
        />
      )}
      {files.dialog}
    </div>
  );
}
SCU_EOF
```

- [ ] **Step 5: Wire Workspace, flip the D2 guard, rewrite the by-design test breaks**

Appends `DemandCell` to `entityCells.tsx`, adds `modelId` to the `<CustomersTab` mount (and replaces its two stale comments), and rewrites the by-design breaks in `CustomersTab.test.tsx` (text-input values, grouped demand, menus, modal, empty JADE demand now blocks), `Workspace.test.tsx` (modal ids) and `Workspace.Brazil.test.tsx` (Download ▾ trigger):

```bash
python3 - <<'PY'
import pathlib
EDITS = [
    ('artifacts/studio/src/__tests__/CustomersTab.test.tsx',
     '''import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CustomersTab } from "@/components/workspace/tabs/CustomersTab";

const customers = [''',
     '''import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CustomersTab } from "@/components/workspace/tabs/CustomersTab";
import { chooseInputDownload, chooseUpload } from "@/__tests__/helpers/inputTable";

const customers = ['''),
    ('artifacts/studio/src/__tests__/CustomersTab.test.tsx',
     '''
    await userEvent.click(screen.getByTestId("button-add-customer-row"));
    await userEvent.type(screen.getByTestId("input-new-customer-city"), "Denver");
    await userEvent.type(screen.getByTestId("input-new-customer-state"), "CO");
    await userEvent.type(screen.getByTestId("input-new-customer-lat"), "39.74");
    await userEvent.type(screen.getByTestId("input-new-customer-lng"), "-104.99");
    await userEvent.type(screen.getByTestId("input-new-customer-demand"), "500");
    await userEvent.click(screen.getByTestId("button-add-customer-confirm"));

    // T9 — same identity model as WarehousesTab: `id` is a T3 stable uid''',
     '''
    await userEvent.click(screen.getByTestId("button-add-customer-row"));
    await userEvent.type(screen.getByTestId("create-entity-city"), "Denver");
    await userEvent.type(screen.getByTestId("create-entity-state"), "CO");
    await userEvent.type(screen.getByTestId("create-entity-lat"), "39.74");
    await userEvent.type(screen.getByTestId("create-entity-lng"), "-104.99");
    await userEvent.type(screen.getByTestId("create-entity-demand"), "500");
    await userEvent.click(screen.getByTestId("create-entity-submit"));

    // T9 — same identity model as WarehousesTab: `id` is a T3 stable uid'''),
    ('artifacts/studio/src/__tests__/CustomersTab.test.tsx',
     '''
    await userEvent.click(screen.getByTestId("button-add-customer-row"));
    await userEvent.type(screen.getByTestId("input-new-customer-lat"), "39.74");
    await userEvent.type(screen.getByTestId("input-new-customer-lng"), "-104.99");
    await userEvent.type(screen.getByTestId("input-new-customer-demand"), "500");
    await userEvent.click(screen.getByTestId("button-add-customer-confirm"));

    expect(onAddedCustomersChange).not.toHaveBeenCalled();
    expect(screen.getByTestId("text-add-customer-error")).toBeInTheDocument();
  });
''',
     '''
    await userEvent.click(screen.getByTestId("button-add-customer-row"));
    await userEvent.type(screen.getByTestId("create-entity-lat"), "39.74");
    await userEvent.type(screen.getByTestId("create-entity-lng"), "-104.99");
    await userEvent.type(screen.getByTestId("create-entity-demand"), "500");
    await userEvent.click(screen.getByTestId("create-entity-submit"));

    expect(onAddedCustomersChange).not.toHaveBeenCalled();
    expect(screen.getByTestId("create-entity-error")).toBeInTheDocument();
  });
'''),
    ('artifacts/studio/src/__tests__/CustomersTab.test.tsx',
     '''
    await userEvent.click(screen.getByTestId("button-add-customer-row"));
    await userEvent.type(screen.getByTestId("input-new-customer-city"), "Boston");
    await userEvent.type(screen.getByTestId("input-new-customer-state"), "MA");
    fireEvent.blur(screen.getByTestId("input-new-customer-state"));
    await userEvent.clear(screen.getByTestId("input-new-customer-display-code"));
    await userEvent.type(screen.getByTestId("input-new-customer-display-code"), "DUPE");
    await userEvent.type(screen.getByTestId("input-new-customer-demand"), "500");
    await userEvent.click(screen.getByTestId("button-add-customer-confirm"));

    expect(onAddedCustomersChange).not.toHaveBeenCalled();
    expect(screen.getByTestId("text-add-customer-error")).toBeInTheDocument();
  });
''',
     '''
    await userEvent.click(screen.getByTestId("button-add-customer-row"));
    await userEvent.type(screen.getByTestId("create-entity-city"), "Boston");
    await userEvent.type(screen.getByTestId("create-entity-state"), "MA");
    fireEvent.blur(screen.getByTestId("create-entity-state"));
    await userEvent.clear(screen.getByTestId("create-entity-display-code"));
    await userEvent.type(screen.getByTestId("create-entity-display-code"), "DUPE");
    await userEvent.type(screen.getByTestId("create-entity-demand"), "500");
    await userEvent.click(screen.getByTestId("create-entity-submit"));

    expect(onAddedCustomersChange).not.toHaveBeenCalled();
    expect(screen.getByTestId("create-entity-error")).toBeInTheDocument();
  });
'''),
    ('artifacts/studio/src/__tests__/CustomersTab.test.tsx',
     '''    );
    await userEvent.click(screen.getByTestId("button-add-customer-row"));
    await userEvent.type(screen.getByTestId("input-new-customer-city"), "Boston");
    await userEvent.type(screen.getByTestId("input-new-customer-state"), "MA");
    fireEvent.blur(screen.getByTestId("input-new-customer-state"));

    expect(screen.getByTestId("input-new-customer-lat")).toHaveValue(42.338551);
    expect(screen.getByTestId("input-new-customer-lng")).toHaveValue(-71.018253);
    expect(screen.getByTestId("input-new-customer-display-code")).toHaveValue("CS-MA-BOSTON-01");
  });
''',
     '''    );
    await userEvent.click(screen.getByTestId("button-add-customer-row"));
    await userEvent.type(screen.getByTestId("create-entity-city"), "Boston");
    await userEvent.type(screen.getByTestId("create-entity-state"), "MA");
    fireEvent.blur(screen.getByTestId("create-entity-state"));

    expect(screen.getByTestId("create-entity-lat")).toHaveValue("42.338551");
    expect(screen.getByTestId("create-entity-lng")).toHaveValue("-71.018253");
    expect(screen.getByTestId("create-entity-display-code")).toHaveValue("CS-MA-BOSTON-01");
  });
'''),
    ('artifacts/studio/src/__tests__/CustomersTab.test.tsx',
     '''    );
    await userEvent.click(screen.getByTestId("button-add-customer-row"));
    await userEvent.type(screen.getByTestId("input-new-customer-city"), "Boston");
    await userEvent.type(screen.getByTestId("input-new-customer-state"), "MA");
    fireEvent.blur(screen.getByTestId("input-new-customer-state"));
    expect(screen.getByTestId("input-new-customer-lat")).toHaveValue(42.338551);

    await userEvent.clear(screen.getByTestId("input-new-customer-lat"));
    await userEvent.type(screen.getByTestId("input-new-customer-lat"), "1.2345");
    expect(screen.getByTestId("input-new-customer-lat")).toHaveValue(1.2345);

    fireEvent.blur(screen.getByTestId("input-new-customer-state"));
    expect(screen.getByTestId("input-new-customer-lat")).toHaveValue(1.2345);
  });
''',
     '''    );
    await userEvent.click(screen.getByTestId("button-add-customer-row"));
    await userEvent.type(screen.getByTestId("create-entity-city"), "Boston");
    await userEvent.type(screen.getByTestId("create-entity-state"), "MA");
    fireEvent.blur(screen.getByTestId("create-entity-state"));
    expect(screen.getByTestId("create-entity-lat")).toHaveValue("42.338551");

    await userEvent.clear(screen.getByTestId("create-entity-lat"));
    await userEvent.type(screen.getByTestId("create-entity-lat"), "1.2345");
    expect(screen.getByTestId("create-entity-lat")).toHaveValue("1.2345");

    fireEvent.blur(screen.getByTestId("create-entity-state"));
    expect(screen.getByTestId("create-entity-lat")).toHaveValue("1.2345");
  });
'''),
    ('artifacts/studio/src/__tests__/CustomersTab.test.tsx',
     '''    );
    await userEvent.click(screen.getByTestId("button-add-customer-row"));
    await userEvent.type(screen.getByTestId("input-new-customer-city"), "Nowheresville");
    await userEvent.type(screen.getByTestId("input-new-customer-state"), "ZZ");
    fireEvent.blur(screen.getByTestId("input-new-customer-state"));

    expect(screen.getByTestId("input-new-customer-lat")).toHaveValue(null);
    expect(screen.getByTestId("input-new-customer-lng")).toHaveValue(null);
    expect(screen.getByTestId("input-new-customer-display-code")).toHaveValue("");
  });
});''',
     '''    );
    await userEvent.click(screen.getByTestId("button-add-customer-row"));
    await userEvent.type(screen.getByTestId("create-entity-city"), "Nowheresville");
    await userEvent.type(screen.getByTestId("create-entity-state"), "ZZ");
    fireEvent.blur(screen.getByTestId("create-entity-state"));

    // SCU-2.P4.11 (B2.8) — text inputs; the modal always derives a display code.
    expect(screen.getByTestId("create-entity-lat")).toHaveValue("");
    expect(screen.getByTestId("create-entity-lng")).toHaveValue("");
    expect(screen.getByTestId("create-entity-display-code")).toHaveValue("CS-ZZ-NOWHERESVILLE-01");
  });
});'''),
    ('artifacts/studio/src/__tests__/CustomersTab.test.tsx',
     '''      </ExportProviderTestWrapper>,
    );
    expect(screen.getByTestId("button-export-customers-csv")).toBeDisabled();
    expect(screen.getByTestId("button-export-customers-json")).toBeDisabled();
    expect(screen.getByTestId("button-import-customers")).toBeDisabled();
  });''',
     '''      </ExportProviderTestWrapper>,
    );
    // SCU-2.P4 (B2.3/B2.4) — one Download ▾ trigger now carries the disabled state.
    expect(screen.getByTestId("button-download-customers")).toBeDisabled();
    expect(screen.getByTestId("button-import-customers")).toBeDisabled();
  });'''),
    ('artifacts/studio/src/__tests__/CustomersTab.test.tsx',
     '''    );

    await userEvent.click(screen.getByTestId("button-export-customers-csv"));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());''',
     '''    );

    chooseInputDownload("customers", "csv");

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());'''),
    ('artifacts/studio/src/__tests__/CustomersTab.test.tsx',
     '''    renderWithQueryClient(<CustomersTab customers={customers} overrides={[]} onChange={vi.fn()} scenarioId={7} />);

    await userEvent.click(screen.getByTestId("button-export-customers-json"));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());''',
     '''    renderWithQueryClient(<CustomersTab customers={customers} overrides={[]} onChange={vi.fn()} scenarioId={7} />);

    chooseInputDownload("customers", "json");

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());'''),
    ('artifacts/studio/src/__tests__/CustomersTab.test.tsx',
     '''    expect(screen.queryByText("Import customers")).not.toBeInTheDocument();

    await userEvent.click(screen.getByTestId("button-import-customers"));

    expect(screen.getByText("Import customers")).toBeInTheDocument();''',
     '''    expect(screen.queryByText("Import customers")).not.toBeInTheDocument();

    chooseUpload("customers", "csv");

    expect(screen.getByText("Import customers")).toBeInTheDocument();'''),
    ('artifacts/studio/src/__tests__/CustomersTab.test.tsx',
     '    );\n\n    await userEvent.click(screen.getByTestId("button-import-customers"));\n    const file = new File(["id,demand\\nC1,250"], "customers.csv", { type: "text/csv" });\n    await userEvent.upload(screen.getByTestId("input-import-file-customers"), file);',
     '    );\n\n    chooseUpload("customers", "csv");\n    const file = new File(["id,demand\\nC1,250"], "customers.csv", { type: "text/csv" });\n    await userEvent.upload(screen.getByTestId("input-import-file-customers"), file);'),
    ('artifacts/studio/src/__tests__/CustomersTab.test.tsx',
     '''    expect(screen.getByTestId("customers-tab")).toBeInTheDocument();
    expect(screen.getByTestId("customers-tab-toolbar")).toBeInTheDocument();
    expect(screen.getByTestId("button-export-customers-csv")).toBeInTheDocument();
    expect(screen.getByTestId("button-import-customers")).toBeInTheDocument();
    expect(screen.getByText("C1")).toBeInTheDocument();''',
     '''    expect(screen.getByTestId("customers-tab")).toBeInTheDocument();
    expect(screen.getByTestId("customers-tab-toolbar")).toBeInTheDocument();
    expect(screen.getByTestId("button-download-customers")).toBeInTheDocument();
    expect(screen.getByTestId("button-import-customers")).toBeInTheDocument();
    expect(screen.getByText("C1")).toBeInTheDocument();'''),
    ('artifacts/studio/src/__tests__/CustomersTab.test.tsx',
     '''      />,
    );
    expect(screen.queryByTestId("add-customer-row-form")).not.toBeInTheDocument();
    await userEvent.click(screen.getByTestId("button-add-customer-row"));
    expect(screen.getByTestId("add-customer-row-form")).toBeInTheDocument();
    expect(screen.getByTestId("customers-tab")).toBeInTheDocument();
    expect(screen.getByText("C1")).toBeInTheDocument();''',
     '''      />,
    );
    expect(screen.queryByTestId("create-entity-dialog")).not.toBeInTheDocument();
    await userEvent.click(screen.getByTestId("button-add-customer-row"));
    expect(screen.getByTestId("create-entity-dialog")).toBeInTheDocument();
    expect(screen.getByTestId("customers-tab")).toBeInTheDocument();
    expect(screen.getByText("C1")).toBeInTheDocument();'''),
    ('artifacts/studio/src/__tests__/CustomersTab.test.tsx',
     '''    expect(screen.getByText("Copper")).toBeInTheDocument();
    expect(screen.getByText("Aluminum")).toBeInTheDocument();
    expect(screen.getByTestId("input-customer-demand-customer-1-product-1")).toHaveValue(10);
    expect(screen.getByTestId("input-customer-demand-customer-1-product-2")).toHaveValue(20);
    // Legacy scalar "Demand" column/input is NOT rendered in product mode.
    expect(screen.queryByTestId("input-customer-demand-customer-1")).not.toBeInTheDocument();''',
     '''    expect(screen.getByText("Copper")).toBeInTheDocument();
    expect(screen.getByText("Aluminum")).toBeInTheDocument();
    // SCU-2.P4.11 (B2.9) — FormattedNumberInput: a text input with grouped display.
    expect(screen.getByTestId("input-customer-demand-customer-1-product-1")).toHaveValue("10");
    expect(screen.getByTestId("input-customer-demand-customer-1-product-2")).toHaveValue("20");
    // Legacy scalar "Demand" column/input is NOT rendered in product mode.
    expect(screen.queryByTestId("input-customer-demand-customer-1")).not.toBeInTheDocument();'''),
    ('artifacts/studio/src/__tests__/CustomersTab.test.tsx',
     '''    );
    await userEvent.click(screen.getByTestId("button-add-customer-row"));
    expect(screen.queryByTestId("input-new-customer-demand")).not.toBeInTheDocument();
    expect(screen.getByTestId("input-new-customer-demand-product-1")).toBeInTheDocument();
    expect(screen.getByTestId("input-new-customer-demand-product-2")).toBeInTheDocument();

    await userEvent.type(screen.getByTestId("input-new-customer-city"), "Denver");
    await userEvent.type(screen.getByTestId("input-new-customer-state"), "CO");
    await userEvent.type(screen.getByTestId("input-new-customer-lat"), "39.74");
    await userEvent.type(screen.getByTestId("input-new-customer-lng"), "-104.99");
    await userEvent.type(screen.getByTestId("input-new-customer-demand-product-1"), "40");
    await userEvent.type(screen.getByTestId("input-new-customer-demand-product-2"), "60");
    await userEvent.click(screen.getByTestId("button-add-customer-confirm"));

    expect(onAddedCustomersChange).toHaveBeenCalledTimes(1);''',
     '''    );
    await userEvent.click(screen.getByTestId("button-add-customer-row"));
    expect(screen.queryByTestId("create-entity-demand")).not.toBeInTheDocument();
    expect(screen.getByTestId("create-entity-demand-product-1")).toBeInTheDocument();
    expect(screen.getByTestId("create-entity-demand-product-2")).toBeInTheDocument();

    await userEvent.type(screen.getByTestId("create-entity-city"), "Denver");
    await userEvent.type(screen.getByTestId("create-entity-state"), "CO");
    await userEvent.type(screen.getByTestId("create-entity-lat"), "39.74");
    await userEvent.type(screen.getByTestId("create-entity-lng"), "-104.99");
    await userEvent.type(screen.getByTestId("create-entity-demand-product-1"), "40");
    await userEvent.type(screen.getByTestId("create-entity-demand-product-2"), "60");
    await userEvent.click(screen.getByTestId("create-entity-submit"));

    expect(onAddedCustomersChange).toHaveBeenCalledTimes(1);'''),
    ('artifacts/studio/src/__tests__/CustomersTab.test.tsx',
     '''  });

  it("a blank product demand cell on the add-row form defaults to 0, not a blocking error", async () => {
    const onAddedCustomersChange = vi.fn();
    render(''',
     '''  });

  // SCU-2.P4.11 (B2.9, user decision 2026-10-17) — an empty per-product demand
  // now BLOCKS submit with a validation message (it used to become 0).
  it("a blank product demand cell on the add form blocks submit with that product's message (no silent 0)", async () => {
    const onAddedCustomersChange = vi.fn();
    render('''),
    ('artifacts/studio/src/__tests__/CustomersTab.test.tsx',
     '''    );
    await userEvent.click(screen.getByTestId("button-add-customer-row"));
    await userEvent.type(screen.getByTestId("input-new-customer-city"), "Denver");
    await userEvent.type(screen.getByTestId("input-new-customer-state"), "CO");
    await userEvent.type(screen.getByTestId("input-new-customer-lat"), "39.74");
    await userEvent.type(screen.getByTestId("input-new-customer-lng"), "-104.99");
    await userEvent.type(screen.getByTestId("input-new-customer-demand-product-1"), "40");
    // product-2 left blank
    await userEvent.click(screen.getByTestId("button-add-customer-confirm"));

    expect(onAddedCustomersChange).toHaveBeenCalledTimes(1);
    const [added] = onAddedCustomersChange.mock.calls[0][0];
    expect(added.demands).toEqual({ "product-1": 40, "product-2": 0 });
    expect(added.demand).toBe(40);
  });
''',
     '''    );
    await userEvent.click(screen.getByTestId("button-add-customer-row"));
    await userEvent.type(screen.getByTestId("create-entity-city"), "Denver");
    await userEvent.type(screen.getByTestId("create-entity-state"), "CO");
    await userEvent.type(screen.getByTestId("create-entity-lat"), "39.74");
    await userEvent.type(screen.getByTestId("create-entity-lng"), "-104.99");
    await userEvent.type(screen.getByTestId("create-entity-demand-product-1"), "40");
    // product-2 left blank
    await userEvent.click(screen.getByTestId("create-entity-submit"));

    expect(onAddedCustomersChange).not.toHaveBeenCalled();
    expect(screen.getByTestId("create-entity-error")).toHaveTextContent(`Demand for ${products[1].name} must be a number ≥ 0.`);
  });
'''),
    ('artifacts/studio/src/__tests__/CustomersTab.test.tsx',
     '''      />,
    );
    expect(screen.getByTestId("input-added-customer-demand-ac-jade-1-product-1")).toHaveValue(40);
    expect(screen.getByTestId("input-added-customer-demand-ac-jade-1-product-2")).toHaveValue(0);
    fireEvent.change(screen.getByTestId("input-added-customer-demand-ac-jade-1-product-2"), { target: { value: "25" } });
    const [nextAdded] = onAddedCustomersChange.mock.calls[0][0];''',
     '''      />,
    );
    expect(screen.getByTestId("input-added-customer-demand-ac-jade-1-product-1")).toHaveValue("40");
    expect(screen.getByTestId("input-added-customer-demand-ac-jade-1-product-2")).toHaveValue("0");
    fireEvent.change(screen.getByTestId("input-added-customer-demand-ac-jade-1-product-2"), { target: { value: "25" } });
    const [nextAdded] = onAddedCustomersChange.mock.calls[0][0];'''),
    ('artifacts/studio/src/__tests__/CustomersTab.test.tsx',
     '''    );
    await userEvent.click(screen.getByTestId("button-add-customer-row"));
    expect(screen.queryByTestId("input-new-customer-state")).not.toBeInTheDocument();
  });
''',
     '''    );
    await userEvent.click(screen.getByTestId("button-add-customer-row"));
    expect(screen.queryByTestId("create-entity-state")).not.toBeInTheDocument();
  });
'''),
    ('artifacts/studio/src/__tests__/CustomersTab.test.tsx',
     '''    );
    await userEvent.click(screen.getByTestId("button-add-customer-row"));
    await userEvent.type(screen.getByTestId("input-new-customer-city"), "Shanghai");
    await userEvent.type(screen.getByTestId("input-new-customer-lat"), "31.23");
    await userEvent.type(screen.getByTestId("input-new-customer-lng"), "121.47");
    await userEvent.type(screen.getByTestId("input-new-customer-demand"), "500");
    await userEvent.click(screen.getByTestId("button-add-customer-confirm"));

    expect(onAddedCustomersChange).toHaveBeenCalledTimes(1);''',
     '''    );
    await userEvent.click(screen.getByTestId("button-add-customer-row"));
    await userEvent.type(screen.getByTestId("create-entity-city"), "Shanghai");
    await userEvent.type(screen.getByTestId("create-entity-lat"), "31.23");
    await userEvent.type(screen.getByTestId("create-entity-lng"), "121.47");
    await userEvent.type(screen.getByTestId("create-entity-demand"), "500");
    await userEvent.click(screen.getByTestId("create-entity-submit"));

    expect(onAddedCustomersChange).toHaveBeenCalledTimes(1);'''),
    ('artifacts/studio/src/__tests__/CustomersTab.test.tsx',
     '''    );
    await userEvent.click(screen.getByTestId("button-add-customer-row"));
    await userEvent.type(screen.getByTestId("input-new-customer-lat"), "31.23");
    await userEvent.type(screen.getByTestId("input-new-customer-lng"), "121.47");
    await userEvent.click(screen.getByTestId("button-add-customer-confirm"));

    expect(onAddedCustomersChange).not.toHaveBeenCalled();
    expect(screen.getByTestId("text-add-customer-error")).toHaveTextContent("City is required.");
  });
});''',
     '''    );
    await userEvent.click(screen.getByTestId("button-add-customer-row"));
    await userEvent.type(screen.getByTestId("create-entity-lat"), "31.23");
    await userEvent.type(screen.getByTestId("create-entity-lng"), "121.47");
    await userEvent.click(screen.getByTestId("create-entity-submit"));

    expect(onAddedCustomersChange).not.toHaveBeenCalled();
    expect(screen.getByTestId("create-entity-error")).toHaveTextContent("City is required.");
  });
});'''),
    ('artifacts/studio/src/__tests__/CustomersTab.test.tsx',
     '''  }));

  it("omitting enableFilters never renders the FilterMenu trigger, even with >10 rows", () => {
    render(<CustomersTab customers={manyCustomers} overrides={[]} onChange={vi.fn()} />);
    expect(screen.queryByTestId("button-filter-menu-trigger")).not.toBeInTheDocument();
  });
''',
     '''  }));

  // SCU-2.P4.11 (spec B2.2) — the FilterMenu shows above 10 rows on every
  // model; enableFilters now only reaches ImportDialog's preview grids.
  it("without enableFilters the FilterMenu still shows above 10 rows (B2.2: all models)", () => {
    render(<CustomersTab customers={manyCustomers} overrides={[]} onChange={vi.fn()} />);
    expect(screen.getByTestId("button-filter-menu-trigger")).toBeInTheDocument();
  });
'''),
    ('artifacts/studio/src/__tests__/CustomersTab.test.tsx',
     '''    render(<CustomersTab customers={manyCustomers} overrides={[]} onChange={vi.fn()} enableFilters />);
    const toolbar = screen.getByTestId("customers-tab-toolbar");
    expect(toolbar).toContainElement(screen.getByTestId("button-export-customers-csv"));
    expect(toolbar).toContainElement(screen.getByTestId("button-import-customers"));
    expect(toolbar).toContainElement(screen.getByTestId("button-filter-menu-trigger"));
  });

  it("non-JADE tab (enableFilters omitted): no FilterMenu anywhere, even with >10 rows", () => {
    render(<CustomersTab customers={manyCustomers} overrides={[]} onChange={vi.fn()} />);
    expect(screen.queryByTestId("button-filter-menu-trigger")).not.toBeInTheDocument();
    expect(screen.getByTestId("customers-tab-toolbar")).toBeInTheDocument();
  });
});''',
     '''    render(<CustomersTab customers={manyCustomers} overrides={[]} onChange={vi.fn()} enableFilters />);
    const toolbar = screen.getByTestId("customers-tab-toolbar");
    expect(toolbar).toContainElement(screen.getByTestId("button-download-customers"));
    expect(toolbar).toContainElement(screen.getByTestId("button-import-customers"));
    expect(toolbar).toContainElement(screen.getByTestId("button-filter-menu-trigger"));
  });

  it("non-JADE tab (enableFilters omitted): the FilterMenu sits in the same toolbar row (B2.2)", () => {
    render(<CustomersTab customers={manyCustomers} overrides={[]} onChange={vi.fn()} />);
    expect(screen.getByTestId("customers-tab-toolbar")).toContainElement(screen.getByTestId("button-filter-menu-trigger"));
  });
});'''),
    ('artifacts/studio/src/components/data-table/entityCells.tsx',
     '''import { X } from "lucide-react";
import { Input } from "@/components/ui/input";

export const READ_ONLY_TITLE = "Read-only while browsing result history.";''',
     '''import { X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { FormattedNumberInput } from "./FormattedNumberInput";

export const READ_ONLY_TITLE = "Read-only while browsing result history.";'''),
    ('artifacts/studio/src/components/data-table/entityCells.tsx',
     '''    />
  );
}
''',
     '''    />
  );
}

/** SCU-2.P4.11 (spec B2.9) — a demand cell: grouped FormattedNumberInput with
 * a visible suffix linked by aria-describedby (no aria-label is added). The
 * suffix is the adapter's: customers "Units", stations "tons" (user decision).
 * Emptying the field shows it blank until blur, then:
 *  - `clearCommits` (base rows, D3): the override is cleared → the base value
 *    returns on blur;
 *  - otherwise (added rows, user decision 2026-10-17): nothing is saved → the
 *    last valid value returns on blur.
 * Without the local `blank` flag FormattedNumberInput would snap back to the
 * unchanged prop value on the very next render, mid-edit. */
export function DemandCell({
  value,
  onCommit,
  clearCommits,
  suffix,
  integer,
  disabled,
  title,
  placeholder,
  testId,
}: {
  value: number | null;
  onCommit: (value: number | null) => void;
  clearCommits: boolean;
  /** Visible unit after the input ("Units" for customers, "tons" for stations). */
  suffix: string;
  integer?: boolean;
  disabled: boolean;
  title?: string;
  placeholder?: string;
  testId: string;
}) {
  const [blank, setBlank] = useState(false);
  return (
    <FormattedNumberInput
      value={blank ? null : value}
      onChange={v => {
        if (v === null) {
          setBlank(true);
          if (clearCommits) onCommit(null);
          return;
        }
        setBlank(false);
        onCommit(v);
      }}
      onBlur={() => setBlank(false)}
      suffix={suffix}
      integer={integer}
      disabled={disabled}
      title={title}
      placeholder={placeholder}
      className="h-7 text-xs font-mono min-w-24"
      data-testid={testId}
    />
  );
}
'''),
    ('artifacts/studio/src/__tests__/Workspace.test.tsx',
     '''    fireEvent.click(screen.getByTestId("button-add-customer-row"));
    fireEvent.change(screen.getByTestId("input-new-customer-city"), { target: { value: "Denver" } });
    fireEvent.change(screen.getByTestId("input-new-customer-state"), { target: { value: "CO" } });
    fireEvent.change(screen.getByTestId("input-new-customer-lat"), { target: { value: "39.74" } });
    fireEvent.change(screen.getByTestId("input-new-customer-lng"), { target: { value: "-104.99" } });
    fireEvent.change(screen.getByTestId("input-new-customer-demand"), { target: { value: "500" } });
    fireEvent.click(screen.getByTestId("button-add-customer-confirm"));
''',
     '''    fireEvent.click(screen.getByTestId("button-add-customer-row"));
    fireEvent.change(screen.getByTestId("create-entity-city"), { target: { value: "Denver" } });
    fireEvent.change(screen.getByTestId("create-entity-state"), { target: { value: "CO" } });
    fireEvent.change(screen.getByTestId("create-entity-lat"), { target: { value: "39.74" } });
    fireEvent.change(screen.getByTestId("create-entity-lng"), { target: { value: "-104.99" } });
    fireEvent.change(screen.getByTestId("create-entity-demand"), { target: { value: "500" } });
    fireEvent.click(screen.getByTestId("create-entity-submit"));
'''),
    ('artifacts/studio/src/__tests__/Workspace.Brazil.test.tsx',
     '''    expect(screen.queryByTestId("tab-content-placeholder")).not.toBeInTheDocument();
    expect(screen.getByTestId("button-export-customers-csv")).toBeInTheDocument();
    expect(screen.getByTestId("button-import-customers")).toBeInTheDocument();''',
     '''    expect(screen.queryByTestId("tab-content-placeholder")).not.toBeInTheDocument();
    expect(screen.getByTestId("button-download-customers")).toBeInTheDocument();
    expect(screen.getByTestId("button-import-customers")).toBeInTheDocument();'''),
    ('artifacts/studio/src/pages/Workspace.tsx',
     '''          // jade-INT (#9, spec §10 D2 "JADE-first") — opt-in FilterMenu,
          // true only on the JADE path; every other model sharing this
          // branch keeps the default `false`.
          enableFilters={isJade}
          // chen-bands-units follow-up (QA defect) — see the Warehouses tab
          // call site's identical comment for the full rationale. Has no
          // effect on JADE's own separate productMode table (out of this
          // fix's scope — see CustomersTabProps.disabled's own comment).
          disabled={isBrowsingHistoryNow}''',
     '''          // jade-INT (#9) — JADE-only FilterMenu on the ImportDialog preview
          // grids. SCU-2.P4.11 (B2.2): the table's own FilterMenu shows on
          // every model above 10 rows and no longer reads this.
          enableFilters={isJade}
          modelId={modelId}
          // History read-only (decision 1h; SCU-2.P4.11 D2) — base, added AND
          // JADE per-product rows.
          disabled={isBrowsingHistoryNow}'''),
]
for path, old, new in EDITS:
    f = pathlib.Path(path)
    s = f.read_text()
    n = s.count(old)
    if n != 1:
        raise SystemExit(f'STOP: {path}: anchor found {n} times (expected 1): {old[:80]!r}')
    f.write_text(s.replace(old, new, 1))
print(f'applied {len(EDITS)} edits')
PY
```

- [ ] **Step 6: Run the task's tests**

Run: `pnpm --filter studio exec vitest run src/__tests__/CustomersTab.dataTable.test.tsx src/__tests__/CustomersTab.test.tsx src/__tests__/Workspace.Brazil.test.tsx src/__tests__/Workspace.test.tsx src/__tests__/historyReadOnlyTabs.test.ts`
Expected: PASS — 250 tests in 5 files (measured at plan time). Then `pnpm --filter studio typecheck` → exit 0.

- [ ] **Step 7: e2e sweep, rewrites and local run**

Sweep (matrix §3 prefixes for this instance; `labs.spec.ts` excluded):
```bash
grep -rn -E 'customers-tab|input-customer-demand-|error-customer-demand-|button-import-customers|button-export-customers|button-customer-|button-add-customer-|input-new-customer-|added-customers-|customer-product-table' artifacts/studio/e2e --include='*.ts' | grep -v labs.spec.ts
```
Rewritten below (matrix §5 item 9): `import.spec.ts` grouped `toHaveValue`, `max-coverage.spec.ts` / `chen-bands-units-qa.spec.ts` `Number(inputValue())` reads, and every `button-import-customers` click (Upload ▾ → CSV). Unchanged and still valid: `bundle2-fastfollow.spec.ts` Brazil base demand `toBeDisabled`, `chen-bands-units-qa.spec.ts` history `toBeDisabled`, `delivery-teaching.spec.ts` `button-customer-C1-excluded`, `workspace-fixups.spec.ts` `button-add-customer-row` visibility, `.fill()` of a plain number into a demand cell (FormattedNumberInput formats it). No spec reads `error-customer-demand-*` (deviation 11).

Apply the rewrites (each anchor is asserted unique; verified against the Bundle 1 tip `e2e/` tree and type-checked at plan time):

```bash
python3 - <<'PY'
import pathlib
EDITS = [
    ('artifacts/studio/e2e/import.spec.ts',
     '''import { test, expect, type Page } from "./fixtures";
''',
     '''import { test, expect, type Page } from "./fixtures";
import { chooseMenuItem, grouped } from "./helpers/inputTable";
'''),
    ('artifacts/studio/e2e/import.spec.ts',
     '''      await page.getByTestId("button-import-customers").click();''',
     '''      // SCU-2.P4.11 (B2.3) — Upload ▾ → CSV.
      await chooseMenuItem(page, "button-import-customers", "button-import-customers-csv");'''),
    ('artifacts/studio/e2e/import.spec.ts',
     '''      await expect(page.getByTestId(`input-customer-demand-${customerId}`)).toHaveValue(
        String(originalDemand + 500),''',
     '''      // SCU-2.P4.11 (B2.9) — the demand cell shows the grouped value.
      await expect(page.getByTestId(`input-customer-demand-${customerId}`)).toHaveValue(
        grouped(originalDemand + 500),'''),
    ('artifacts/studio/e2e/max-coverage.spec.ts',
     '''import { chooseMenuItem, closePopover, fillTableFilter } from "./helpers/inputTable";
''',
     '''import { chooseMenuItem, closePopover, fillTableFilter, readGroupedNumber } from "./helpers/inputTable";
'''),
    ('artifacts/studio/e2e/max-coverage.spec.ts',
     '''      const currentDemand = Number(await demandInput.inputValue()) || 0;''',
     '''      // SCU-2.P4.11 (B2.9) — grouped display ("1,234"): Number() of it is NaN.
      const currentDemand = (await readGroupedNumber(demandInput)) || 0;'''),
    ('artifacts/studio/e2e/max-coverage.spec.ts',
     '''      await page.getByTestId("button-import-customers").click();''',
     '''      await chooseMenuItem(page, "button-import-customers", "button-import-customers-csv");'''),
    ('artifacts/studio/e2e/chen-bands-units-qa.spec.ts',
     '''import { closePopover, fillTableFilter } from "./helpers/inputTable";
''',
     '''import { closePopover, fillTableFilter, grouped, readGroupedNumber } from "./helpers/inputTable";
'''),
    ('artifacts/studio/e2e/chen-bands-units-qa.spec.ts',
     '''      const original = Number(await demandInput.inputValue()) || 0;''',
     '''      // SCU-2.P4.11 (B2.9) — demand is displayed grouped; read it as a number.
      const original = (await readGroupedNumber(demandInput)) || 0;'''),
    ('artifacts/studio/e2e/chen-bands-units-qa.spec.ts',
     '''      const beforeDirtyValue = await demandInput2.inputValue();''',
     '''      const beforeDirtyValue = String(await readGroupedNumber(demandInput2));'''),
    ('artifacts/studio/e2e/chen-bands-units-qa.spec.ts',
     '''toHaveValue(String(Number(beforeDirtyValue) + 500));''',
     '''toHaveValue(grouped(Number(beforeDirtyValue) + 500));'''),
    ('artifacts/studio/e2e/chen-bands-units-qa.spec.ts',
     '''      const savedLatestValue = await latestDemand2.inputValue();''',
     '''      const savedLatestValue = String(await readGroupedNumber(latestDemand2));'''),
    ('artifacts/studio/e2e/jade-two-echelon.spec.ts',
     '''import { closePopover, fillTableFilter } from "./helpers/inputTable";
''',
     '''import { chooseMenuItem, closePopover, fillTableFilter } from "./helpers/inputTable";
'''),
    ('artifacts/studio/e2e/jade-two-echelon.spec.ts',
     '''      await page.getByTestId("button-import-customers").click({ timeout: HEADER_TIMEOUT });''',
     '''      // SCU-2.P4.11 (B2.3) — Upload ▾ → CSV.
      await chooseMenuItem(page, "button-import-customers", "button-import-customers-csv");'''),
]
for path, old, new in EDITS:
    f = pathlib.Path(path)
    s = f.read_text()
    n = s.count(old)
    if n != 1:
        raise SystemExit(f'STOP: {path}: anchor found {n} times (expected 1): {old[:80]!r}')
    f.write_text(s.replace(old, new, 1))
print(f'applied {len(EDITS)} edits')
PY
```

Then `pnpm --filter studio typecheck:e2e` (exit 0) and, with both local servers up (Global Constraints), run
```bash
cd artifacts/studio && E2E_BASE_URL=http://localhost:5179 npx playwright test e2e/import.spec.ts e2e/chen-bands-units-qa.spec.ts e2e/max-coverage.spec.ts e2e/bundle2-fastfollow.spec.ts e2e/jade-two-echelon.spec.ts e2e/delivery-teaching.spec.ts e2e/workspace-fixups.spec.ts
```
Expected: every test passes (a failure → flake registry by test name, two isolated re-runs, before calling it a regression). Record per-spec pass/fail in the changelog entry.

- [ ] **Step 8: Gate**

Run each separately (Global Constraints):
1. `cnt=$(ps aux | grep "[v]itest" | grep -v "zsh -c" | wc -l | tr -d ' '); [ "$cnt" = "0" ]`
2. `pnpm run typecheck`
3. `pnpm --filter studio typecheck:e2e`
4. `DATABASE_URL="postgresql://shubhamkr@localhost:5432/nos_dev" pnpm --filter api-server test`
5. `pnpm --filter studio test`
6. `(cd artifacts/api-server/src/solver && python3 -m pytest tests/ -x)`
7. `pnpm --filter @workspace/import-schema test`

Expected: every command exits 0. Then `git diff --stat "$P3_TIP"..HEAD -- artifacts/api-server lib/db lib/api-spec` prints nothing.

- [ ] **Step 9: Changelog**

Append to the bottom of `docs/CHANGELOG-implementation.md`:

```markdown

### SCU-2.P4.11 — Customers

- Customers (scalar + JADE) on DataTable: base + added sections, one FilterMenu on every model, pager > 50, Upload ▾/Download ▾, "+ Add customer" modal (empty demand blocks, incl. JADE per-product).
- B2.9: `DemandCell` (FormattedNumberInput, Units suffix, no aria-label; base empty → clear override, added empty → not saved, reverts on blur); Brazil lock base-only; D2 read-only on base, added and JADE rows (JADE was live).
- e2e demand reads rewritten for grouped values (import, chen-bands-units-qa, max-coverage).
- Deviations 1, 2, 3, 9, 10, 11, 13, 14, 15, 17, 18.
- Gate: studio <N passed>, api-server <N passed>, pytest <N passed>, import-schema <N passed>. e2e (local, `E2E_BASE_URL` set): <spec: pass/fail per spec>.
```

Replace each `<…>` with the value measured in this run, or the literal `unknown`.

- [ ] **Step 10: Commit**

```bash
git add artifacts/studio/src/__tests__/CustomersTab.dataTable.test.tsx
```

```bash
[ "$(git rev-parse --abbrev-ref HEAD)" != "main" ] || exit 1
```

```bash
git commit artifacts/studio/src/__tests__/CustomersTab.dataTable.test.tsx artifacts/studio/src/components/workspace/tabs/CustomersTab.tsx artifacts/studio/src/__tests__/CustomersTab.test.tsx artifacts/studio/src/components/data-table/entityCells.tsx artifacts/studio/src/__tests__/Workspace.test.tsx artifacts/studio/src/__tests__/Workspace.Brazil.test.tsx artifacts/studio/src/pages/Workspace.tsx artifacts/studio/e2e/import.spec.ts artifacts/studio/e2e/max-coverage.spec.ts artifacts/studio/e2e/chen-bands-units-qa.spec.ts artifacts/studio/e2e/jade-two-echelon.spec.ts docs/CHANGELOG-implementation.md -m "[SCU-2.P4.11] move Customers onto DataTable with the formatted demand cell and add modal" -m "Scalar + JADE per-product in one DataTable (sections), FormattedNumberInput demand (B2.9), empty demand blocks add, D2 read-only incl. JADE, one FilterMenu. One commit for #21-#24 (dev 1). Deviations 1-3, 9-11, 13-15, 17, 18." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task SCU-2.P4.12: JADE Plants on DataTable (one shared filter menu) with the +Add modal

**Owner role:** frontend-engineer. **Matrix:** §1 #25–#26, §2c Plants base + added. **Spec:** B2.1–B2.4, B2.8, D2; user decision 2026-10-17 (one menu). **Deviations:** 1, 3, 9, 13, 15, 17.

**Files:**
- Create: `artifacts/studio/src/__tests__/PlantsTab.dataTable.test.tsx`
- Modify: `artifacts/studio/src/components/workspace/tabs/PlantsTab.tsx`
- Modify: `artifacts/studio/src/__tests__/PlantsTab.test.tsx`
- Modify: `artifacts/studio/src/__tests__/Workspace.Jade.test.tsx`
- Modify: `artifacts/studio/src/pages/Workspace.tsx`
- Modify: `artifacts/studio/src/__tests__/historyReadOnlyTabs.test.ts`
- Modify: `artifacts/studio/e2e/workspace-fixups-2.spec.ts`
- Modify: `docs/CHANGELOG-implementation.md` (append `### SCU-2.P4.12`)

**Interfaces:**
- Consumes: P4.10 `entityCells` (`DeleteRowButton`, `READ_ONLY_TITLE`); P4.2 modal (`entityKind: "plant"`).
- Produces: `PlantsTab` prop `readOnly?: boolean`; new pager ids `button-plants-prev/next`, `plants-page-indicator`.

**Behaviour changes (record each in the changelog):**
- Base and added plants share ONE FilterMenu in the toolbar (there were two independent menus).
- "+ Add plant" opens the modal (no status, no value); ids/codes from `lib/entityId` (`ap-`/`PL-…`, unchanged output).
- History read-only on delete and the add trigger (D2 — PlantsTab had no prop).
- Upload ▾ / Download ▾; numbers centred.

- [ ] **Step 0: Invoke the simplicity skills**

Skill tool: `andrej-karpathy-skills:karpathy-guidelines`, then `ponytail:ponytail`. Record in the report that both ran (hard rule #12).

- [ ] **Step 1: Preconditions**

Run each line alone (worktree root):
```bash
cd /Users/shubhamkr/nos-scu-2.p4.12 && git rev-parse --abbrev-ref HEAD
git merge-base --is-ancestor "$BASE" HEAD || exit 1
git merge-base --is-ancestor "$B1_TIP" HEAD || exit 1
git merge-base --is-ancestor "$P3_TIP" HEAD || exit 1
test -f artifacts/studio/src/components/data-table/DataTable.tsx && test -f artifacts/studio/src/components/data-table/DownloadMenu.tsx && test -d lib/import-schema || exit 1
pnpm install --frozen-lockfile
```
Then confirm the files this task replaces wholesale are still the `46d2f98` text (Global Constraints):
```bash
git diff --quiet 46d2f98 HEAD -- artifacts/studio/src/components/workspace/tabs/PlantsTab.tsx || { echo 'STOP: artifacts/studio/src/components/workspace/tabs/PlantsTab.tsx changed since 46d2f98'; exit 1; }
```

- [ ] **Step 2: Write the failing test**

Create `artifacts/studio/src/__tests__/PlantsTab.dataTable.test.tsx`:

```bash
mkdir -p artifacts/studio/src/__tests__ && cat > artifacts/studio/src/__tests__/PlantsTab.dataTable.test.tsx <<'SCU_EOF'
// SCU-2.P4.12 — JADE Plants on the shared DataTable (spec B2.1–B2.4, B2.8,
// D2): matrix testids, one filter menu over base + added, history read-only
// on the added rows' delete and the add trigger, and the "+ Add plant" modal.

import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { AllProviders } from "@/__tests__/helpers/renderWithExportProvider";
import { PlantsTab, type AddedPlant } from "@/components/workspace/tabs/PlantsTab";

const plants = [
  { id: "plant-1", name: "Plant One", city: "Ashland", state: "KY", lat: 38.4, lng: -82.6 },
  { id: "plant-2", name: "Plant Two", city: "Toledo", state: "OH", lat: 41.6, lng: -83.5 },
];
const added: AddedPlant[] = [{ id: "ap-1", city: "Dallas", state: "TX", lat: 32.78, lng: -96.8, displayCode: "PL-TX-DALLAS-01" }];

const renderTab = (props: Partial<React.ComponentProps<typeof PlantsTab>> = {}) =>
  render(<PlantsTab plants={plants} scenarioId={1} addedPlants={added} onAddedPlantsChange={vi.fn()} onDeletePlant={vi.fn()} {...props} />, { wrapper: AllProviders });

describe("PlantsTab on DataTable (SCU-2.P4.12)", () => {
  it("emits every testid in the matrix map", () => {
    renderTab();
    for (const id of ["plants-tab", "plants-tab-toolbar", "button-import-plants", "button-download-plants", "button-add-plant-row", "added-plants-section", "row-added-plant-ap-1", "button-delete-added-plant-ap-1"]) {
      expect(screen.getByTestId(id)).toBeInTheDocument();
    }
    // base rows show the plant NAME (unchanged), added rows the display code
    expect(screen.getByText("Plant One")).toBeInTheDocument();
    expect(within(screen.getByTestId("row-added-plant-ap-1")).getByText("PL-TX-DALLAS-01")).toBeInTheDocument();
  });

  it("empty-dataset and empty-added states keep their testids", () => {
    renderTab({ plants: [], addedPlants: [] });
    expect(screen.getByTestId("plants-tab-empty")).toHaveTextContent("No plants in this dataset.");
    expect(screen.getByTestId("added-plants-empty")).toBeInTheDocument();
  });

  it("history read-only (D2): delete and the add trigger are disabled (they had no disabled prop)", () => {
    renderTab({ readOnly: true });
    expect(screen.getByTestId("button-delete-added-plant-ap-1")).toBeDisabled();
    expect(screen.getByTestId("button-add-plant-row")).toBeDisabled();
  });

  it("+ Add plant opens the modal (no status, no value); submit appends an ap-/PL- plant", () => {
    const onAdded = vi.fn();
    renderTab({ onAddedPlantsChange: onAdded });
    fireEvent.click(screen.getByTestId("button-add-plant-row"));
    const d = screen.getByTestId("create-entity-dialog");
    expect(within(d).queryByTestId("create-entity-status")).toBeNull();
    expect(within(d).queryByTestId("create-entity-capacity")).toBeNull();
    for (const [id, v] of [["create-entity-city", "Akron"], ["create-entity-state", "OH"], ["create-entity-lat", "41.08"], ["create-entity-lng", "-81.52"]] as const) {
      fireEvent.change(within(d).getByTestId(id), { target: { value: v } });
    }
    fireEvent.click(within(d).getByTestId("create-entity-submit"));
    const next = onAdded.mock.calls[0]![0] as AddedPlant[];
    expect(next).toHaveLength(2);
    expect(next[1]!.id).toMatch(/^ap-/);
    expect(next[1]).toMatchObject({ city: "Akron", state: "OH", lat: 41.08, lng: -81.52, displayCode: "PL-OH-AKRON-01" });
  });
});
SCU_EOF
```

- [ ] **Step 3: Run it to verify it fails**

Run: `pnpm --filter studio exec vitest run src/__tests__/PlantsTab.dataTable.test.tsx`
Expected: FAIL — `Tests  3 failed | 1 passed (4)` (measured at plan time against the pre-migration tab) — the history test finds enabled controls (and `readOnly` is not yet a prop — a type error under `pnpm --filter studio typecheck`), and the menu/filter/centring assertions find today's single buttons, From/To boxes and left-aligned numbers.

- [ ] **Step 4: Implement — `PlantsTab.tsx`**

Replace the whole file `artifacts/studio/src/components/workspace/tabs/PlantsTab.tsx` with:

```bash
mkdir -p artifacts/studio/src/components/workspace/tabs && cat > artifacts/studio/src/components/workspace/tabs/PlantsTab.tsx <<'SCU_EOF'
import { useState } from "react";
import type { Plant, Scenario } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { CreateEntityDialog } from "@/components/workspace/map/dialogs/CreateEntityDialog";
import { DataTable } from "@/components/data-table/DataTable";
import type { ColumnDef } from "@/components/data-table/types";
import { useEntityFileMenus } from "@/components/data-table/useEntityFileMenus";
import { DeleteRowButton, READ_ONLY_TITLE } from "@/components/data-table/entityCells";

// T11 — matches `jadeInputsSchema`'s `addedPlants[]` shape exactly
// (`{ id, displayCode?, city, state, lat, lng }`, spec §5): geometry only.
// A plant has no status and no capacity of its own — every bit of its
// editable behavior (which product(s) it can make) lives in the Capability
// Matrix tab (T11's `CapabilityMatrixTab`), driven by `plantProductCapability`
// overrides keyed by this same `id`.
export interface AddedPlant {
  id: string;
  city: string;
  state: string;
  lat: number;
  lng: number;
  displayCode?: string;
}

interface PlantsTabProps {
  /** Base dataset plants (Chapter 9 JADE only — `Dataset.plants`, absent for
   * every other model). Read-only: id/city/state/lat/lng, no status/capacity
   * column at all (spec §6 — "id, city/state, lat/lon (read-only base +
   * added rows)"). */
  plants: Plant[];
  /** Undefined while the scenario hasn't resolved yet — Upload/Download stay disabled until it has. */
  scenarioId?: number;
  /** Fired after a successful import apply, with the updated scenario — the caller (Workspace.tsx) refreshes its inputs draft from it. */
  onImportApplied?: (scenario: Scenario) => void;
  /** Scenario-local addedPlants. Fired on both add (append) and in-row edits
   * — full replacement array, same `onChange`-out convention as every other
   * tab. Gates the "Added plants" section's render (capability-based, not
   * `modelId ===` — Gate 6/1.9). */
  addedPlants?: AddedPlant[];
  onAddedPlantsChange?: (next: AddedPlant[]) => void;
  /** Fired on delete only — kept separate from onAddedPlantsChange because
   * the caller (Workspace.tsx) also needs to purge any
   * `plantProductCapability` overrides AND plant→warehouse
   * `distanceOverrides` referencing this id in the SAME atomic inputs
   * update (spec §6's plant delete/copy reconciliation — T12's job to wire,
   * this tab only fires the intent). */
  onDeletePlant?: (id: string) => void;
  /** SCU-2.P4.12 (D2) — browsing result history: the delete buttons and the
   * "+ Add plant" trigger are disabled (base plants have no editable cells). */
  readOnly?: boolean;
}

/** One effective row: a base dataset plant (read-only) or an added plant. */
interface PlantRow {
  id: string;
  /** Base: `name ?? id` (unchanged); added: `displayCode ?? id`. Also the ID filter value. */
  displayId: string;
  city: string;
  state: string;
  lat: number;
  lng: number;
  added: boolean;
}

// T11 → SCU-2.P4.12 (spec B2.1–B2.4, B2.8, D2) — JADE's Plants tab on the
// shared DataTable: base (read-only) and added plants are two sections under
// ONE toolbar and ONE filter menu (user decision 2026-10-17 — it had two
// independent menus), "+ Add plant" opens the CreateEntityDialog modal (the
// plant uid/code helpers this file used to carry are lib/entityId's `pl`
// kind, `ap-` / `PL-…`, identical output).
export function PlantsTab({
  plants,
  scenarioId,
  onImportApplied,
  addedPlants = [],
  onAddedPlantsChange,
  onDeletePlant,
  readOnly = false,
}: PlantsTabProps) {
  const files = useEntityFileMenus({
    entity: "plants",
    testIdEntity: "plants",
    modelId: "two-echelon-jade-us",
    scenarioId,
    onImportApplied,
  });
  const [adding, setAdding] = useState(false);

  const rows: PlantRow[] = [
    ...plants.map(p => ({
      id: p.id,
      displayId: p.name ?? p.id,
      city: p.city,
      state: p.state,
      lat: p.lat,
      lng: p.lng,
      added: false,
    })),
    ...addedPlants.map(p => ({
      id: p.id,
      displayId: p.displayCode ?? p.id,
      city: p.city,
      state: p.state,
      lat: p.lat,
      lng: p.lng,
      added: true,
    })),
  ];

  const columns: ColumnDef<PlantRow>[] = [
    {
      id: "id",
      header: "ID",
      kind: "text",
      filter: "text",
      value: r => r.displayId,
      cellClassName: "font-mono text-xs",
      cell: r => r.displayId,
    },
    { id: "city", header: "City", kind: "text", filter: "text", value: r => r.city, cellClassName: "text-xs", cell: r => r.city },
    {
      id: "state",
      header: "State",
      kind: "text",
      filter: "text",
      value: r => r.state || null,
      cellClassName: "text-xs",
      cell: r => r.state,
    },
    {
      id: "lat",
      header: "Latitude",
      kind: "number",
      value: r => r.lat,
      cellClassName: "text-xs font-mono",
      cell: r => r.lat.toFixed(4),
    },
    {
      id: "lng",
      header: "Longitude",
      kind: "number",
      value: r => r.lng,
      cellClassName: "text-xs font-mono",
      cell: r => r.lng.toFixed(4),
    },
  ];
  const addedColumns: ColumnDef<PlantRow>[] = [
    ...columns,
    {
      id: "delete",
      header: "",
      kind: "text",
      filter: false,
      value: () => null,
      cell: r => (
        <DeleteRowButton
          label={`Delete added plant ${r.id}`}
          onClick={() => onDeletePlant?.(r.id)}
          disabled={readOnly}
          testId={`button-delete-added-plant-${r.id}`}
        />
      ),
    },
  ];

  const addTrigger = onAddedPlantsChange != null && (
    <Button
      size="sm"
      variant="outline"
      className="h-7 px-2 text-xs"
      onClick={() => setAdding(true)}
      disabled={readOnly}
      title={readOnly ? READ_ONLY_TITLE : undefined}
      data-testid="button-add-plant-row"
    >
      + Add plant
    </Button>
  );

  return (
    <div data-testid="plants-tab">
      <DataTable<PlantRow>
        rows={rows}
        rowKey={r => `${r.added ? "added" : "base"}:${r.id}`}
        columns={columns}
        ctx={{ readOnly, demandEditable: false, isAdded: r => r.added }}
        testIds={{
          toolbar: "plants-tab-toolbar",
          pagerPrev: "button-plants-prev",
          pagerNext: "button-plants-next",
          pageIndicator: "plants-page-indicator",
        }}
        toolbar={{ upload: files.upload, download: files.download, add: addTrigger }}
        sections={[
          {
            id: "base",
            includes: r => !r.added,
            scrollClassName: "max-h-[60vh] overflow-y-auto",
            emptyState: (
              <p className="text-sm text-muted-foreground" data-testid="plants-tab-empty">
                No plants in this dataset.
              </p>
            ),
          },
          ...(onAddedPlantsChange != null
            ? [
                {
                  id: "added",
                  title: "Added plants",
                  testId: "added-plants-section",
                  includes: (r: PlantRow) => r.added,
                  columns: addedColumns,
                  rowTestId: (r: PlantRow) => `row-added-plant-${r.id}`,
                  scrollClassName: "max-h-[40vh] overflow-y-auto",
                  emptyState: (
                    <p className="text-xs text-muted-foreground" data-testid="added-plants-empty">
                      No added plants yet — use "+ Add plant" above to create one.
                    </p>
                  ),
                },
              ]
            : []),
        ]}
      />
      {adding && (
        <CreateEntityDialog
          source="table"
          entityKind="plant"
          existingCodes={addedPlants.map(p => p.displayCode).filter((c): c is string => !!c)}
          onCreate={r => {
            if (r.kind === "plant") onAddedPlantsChange?.([...addedPlants, r.entity]);
            setAdding(false);
          }}
          onCancel={() => setAdding(false)}
        />
      )}
      {files.dialog}
    </div>
  );
}
SCU_EOF
```

- [ ] **Step 5: Wire Workspace, flip the D2 guard, rewrite the by-design test breaks**

Adds `readOnly={isBrowsingHistoryNow}` to the `<PlantsTab` mount, flips the guard, and rewrites `PlantsTab.test.tsx` (two-menu tests → one shared menu; menus; modal) and `Workspace.Jade.test.tsx` (modal ids):

```bash
python3 - <<'PY'
import pathlib
EDITS = [
    ('artifacts/studio/src/__tests__/PlantsTab.test.tsx',
     '''import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PlantsTab } from "@/components/workspace/tabs/PlantsTab";

// T11 (Chapter 9 JADE) — a plant has neither status nor capacity of its''',
     '''import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PlantsTab } from "@/components/workspace/tabs/PlantsTab";
import { chooseInputDownload, chooseUpload } from "@/__tests__/helpers/inputTable";

// T11 (Chapter 9 JADE) — a plant has neither status nor capacity of its'''),
    ('artifacts/studio/src/__tests__/PlantsTab.test.tsx',
     '''
    await userEvent.click(screen.getByTestId("button-add-plant-row"));
    await userEvent.type(screen.getByTestId("input-new-plant-city"), "Denver");
    await userEvent.type(screen.getByTestId("input-new-plant-state"), "CO");
    await userEvent.type(screen.getByTestId("input-new-plant-lat"), "39.74");
    await userEvent.type(screen.getByTestId("input-new-plant-lng"), "-104.99");
    await userEvent.click(screen.getByTestId("button-add-plant-confirm"));

    expect(onAddedPlantsChange).toHaveBeenCalledTimes(1);''',
     '''
    await userEvent.click(screen.getByTestId("button-add-plant-row"));
    await userEvent.type(screen.getByTestId("create-entity-city"), "Denver");
    await userEvent.type(screen.getByTestId("create-entity-state"), "CO");
    await userEvent.type(screen.getByTestId("create-entity-lat"), "39.74");
    await userEvent.type(screen.getByTestId("create-entity-lng"), "-104.99");
    await userEvent.click(screen.getByTestId("create-entity-submit"));

    expect(onAddedPlantsChange).toHaveBeenCalledTimes(1);'''),
    ('artifacts/studio/src/__tests__/PlantsTab.test.tsx',
     '''    );
    await userEvent.click(screen.getByTestId("button-add-plant-row"));
    await userEvent.type(screen.getByTestId("input-new-plant-lat"), "39.74");
    await userEvent.type(screen.getByTestId("input-new-plant-lng"), "-104.99");
    await userEvent.click(screen.getByTestId("button-add-plant-confirm"));

    expect(onAddedPlantsChange).not.toHaveBeenCalled();
    expect(screen.getByTestId("text-add-plant-error")).toBeInTheDocument();
  });
''',
     '''    );
    await userEvent.click(screen.getByTestId("button-add-plant-row"));
    await userEvent.type(screen.getByTestId("create-entity-lat"), "39.74");
    await userEvent.type(screen.getByTestId("create-entity-lng"), "-104.99");
    await userEvent.click(screen.getByTestId("create-entity-submit"));

    expect(onAddedPlantsChange).not.toHaveBeenCalled();
    expect(screen.getByTestId("create-entity-error")).toBeInTheDocument();
  });
'''),
    ('artifacts/studio/src/__tests__/PlantsTab.test.tsx',
     '''      </ExportProviderTestWrapper>,
    );
    expect(screen.getByTestId("button-export-plants-csv")).toBeDisabled();
    expect(screen.getByTestId("button-export-plants-json")).toBeDisabled();
    expect(screen.getByTestId("button-import-plants")).toBeDisabled();
  });''',
     '''      </ExportProviderTestWrapper>,
    );
    // SCU-2.P4 (B2.3/B2.4) — one Download ▾ trigger now carries the disabled state.
    expect(screen.getByTestId("button-download-plants")).toBeDisabled();
    expect(screen.getByTestId("button-import-plants")).toBeDisabled();
  });'''),
    ('artifacts/studio/src/__tests__/PlantsTab.test.tsx',
     '''    );

    await userEvent.click(screen.getByTestId("button-export-plants-csv"));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());''',
     '''    );

    chooseInputDownload("plants", "csv");

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());'''),
    ('artifacts/studio/src/__tests__/PlantsTab.test.tsx',
     '''    renderWithQueryClient(<PlantsTab plants={plants} scenarioId={7} />);
    expect(screen.queryByText("Import plants")).not.toBeInTheDocument();
    await userEvent.click(screen.getByTestId("button-import-plants"));
    expect(screen.getByText("Import plants")).toBeInTheDocument();
    expect(screen.getByTestId("input-import-file-plants")).toBeInTheDocument();''',
     '''    renderWithQueryClient(<PlantsTab plants={plants} scenarioId={7} />);
    expect(screen.queryByText("Import plants")).not.toBeInTheDocument();
    chooseUpload("plants", "csv");
    expect(screen.getByText("Import plants")).toBeInTheDocument();
    expect(screen.getByTestId("input-import-file-plants")).toBeInTheDocument();'''),
    ('artifacts/studio/src/__tests__/PlantsTab.test.tsx',
     '    renderWithQueryClient(<PlantsTab plants={plants} scenarioId={7} onImportApplied={onImportApplied} />);\n\n    await userEvent.click(screen.getByTestId("button-import-plants"));\n    const file = new File(["id,city\\nplant-1,Daggar Hills"], "plants.csv", { type: "text/csv" });\n    await userEvent.upload(screen.getByTestId("input-import-file-plants"), file);',
     '    renderWithQueryClient(<PlantsTab plants={plants} scenarioId={7} onImportApplied={onImportApplied} />);\n\n    chooseUpload("plants", "csv");\n    const file = new File(["id,city\\nplant-1,Daggar Hills"], "plants.csv", { type: "text/csv" });\n    await userEvent.upload(screen.getByTestId("input-import-file-plants"), file);'),
    ('artifacts/studio/src/__tests__/PlantsTab.test.tsx',
     '''    expect(screen.getByTestId("plants-tab")).toBeInTheDocument();
    expect(screen.getByTestId("plants-tab-toolbar")).toBeInTheDocument();
    expect(screen.getByTestId("button-export-plants-csv")).toBeInTheDocument();
    expect(screen.getByTestId("button-import-plants")).toBeInTheDocument();
    expect(screen.getByText("Daggar Hills")).toBeInTheDocument();''',
     '''    expect(screen.getByTestId("plants-tab")).toBeInTheDocument();
    expect(screen.getByTestId("plants-tab-toolbar")).toBeInTheDocument();
    expect(screen.getByTestId("button-download-plants")).toBeInTheDocument();
    expect(screen.getByTestId("button-import-plants")).toBeInTheDocument();
    expect(screen.getByText("Daggar Hills")).toBeInTheDocument();'''),
    ('artifacts/studio/src/__tests__/PlantsTab.test.tsx',
     '''      />,
    );
    expect(screen.queryByTestId("add-plant-row-form")).not.toBeInTheDocument();
    await userEvent.click(screen.getByTestId("button-add-plant-row"));
    expect(screen.getByTestId("add-plant-row-form")).toBeInTheDocument();
    expect(screen.getByTestId("plants-tab")).toBeInTheDocument();
    expect(screen.getByText("Daggar Hills")).toBeInTheDocument();''',
     '''      />,
    );
    expect(screen.queryByTestId("create-entity-dialog")).not.toBeInTheDocument();
    await userEvent.click(screen.getByTestId("button-add-plant-row"));
    expect(screen.getByTestId("create-entity-dialog")).toBeInTheDocument();
    expect(screen.getByTestId("plants-tab")).toBeInTheDocument();
    expect(screen.getByText("Daggar Hills")).toBeInTheDocument();'''),
    ('artifacts/studio/src/__tests__/PlantsTab.test.tsx',
     '''  });

  it("the Added-plants table with >10 added rows SHOWS its own FilterMenu (positive test), independent of the (4-row, hidden) base table", () => {
    render(
      <PlantsTab''',
     '''  });

  // SCU-2.P4.12 (spec B2.2, user decision 2026-10-17) — base and added plants
  // now share ONE FilterMenu in the toolbar (there used to be two). It shows
  // once base + added rows exceed 10, and filters both sections.
  it("4 base + 11 added plants: ONE FilterMenu, in the toolbar (none in the added section)", () => {
    render(
      <PlantsTab'''),
    ('artifacts/studio/src/__tests__/PlantsTab.test.tsx',
     '''      />,
    );
    const toolbar = screen.getByTestId("plants-tab-toolbar");
    const addedSection = screen.getByTestId("added-plants-section");
    // Base table (4 rows) still hides its own menu...
    expect(within(toolbar).queryByTestId("button-filter-menu-trigger")).not.toBeInTheDocument();
    // ...while the Added-plants table (11 rows, >10) shows its own.
    expect(within(addedSection).getByTestId("button-filter-menu-trigger")).toBeInTheDocument();
  });

  it("filtering the Added-plants table narrows its rows without affecting the (unfiltered) base table", async () => {
    render(
      <PlantsTab''',
     '''      />,
    );
    expect(screen.getAllByTestId("button-filter-menu-trigger")).toHaveLength(1);
    expect(within(screen.getByTestId("plants-tab-toolbar")).getByTestId("button-filter-menu-trigger")).toBeInTheDocument();
    expect(within(screen.getByTestId("added-plants-section")).queryByTestId("button-filter-menu-trigger")).not.toBeInTheDocument();
  });

  it("the shared filter narrows base AND added rows together", async () => {
    render(
      <PlantsTab'''),
    ('artifacts/studio/src/__tests__/PlantsTab.test.tsx',
     '''
    const user = userEvent.setup();
    await user.click(within(addedSection).getByTestId("button-filter-menu-trigger"));
    await user.type(screen.getByTestId("input-filter-city"), "AddedCity1");

    // "AddedCity1" matches AddedCity1 and AddedCity10/11 (substring) — 3 rows.
    expect(within(addedSection).getAllByTestId(/^row-added-plant-/).length).toBe(3);
    // Base table is completely unaffected.
    expect(screen.getByText("Daggar Hills")).toBeInTheDocument();
    expect(screen.getByText("Cunnamulla")).toBeInTheDocument();
    expect(screen.getByText("Brisbane")).toBeInTheDocument();
    expect(screen.getByText("Toowoomba")).toBeInTheDocument();
  });
''',
     '''
    const user = userEvent.setup();
    await user.click(screen.getByTestId("button-filter-menu-trigger"));
    await user.type(screen.getByTestId("input-filter-city"), "AddedCity1");

    // "AddedCity1" matches AddedCity1 and AddedCity10/11 (substring) — 3 rows.
    expect(within(screen.getByTestId("added-plants-section")).getAllByTestId(/^row-added-plant-/).length).toBe(3);
    // ...and the base plants (no match) are filtered out too — one menu, both sections.
    expect(screen.queryByText("Daggar Hills")).not.toBeInTheDocument();
  });
'''),
    ('artifacts/studio/src/__tests__/PlantsTab.test.tsx',
     '''    render(<PlantsTab plants={manyPlants} />);
    const toolbar = screen.getByTestId("plants-tab-toolbar");
    expect(within(toolbar).getByTestId("button-export-plants-csv")).toBeInTheDocument();
    expect(within(toolbar).getByTestId("button-import-plants")).toBeInTheDocument();
    expect(within(toolbar).getByTestId("button-filter-menu-trigger")).toBeInTheDocument();''',
     '''    render(<PlantsTab plants={manyPlants} />);
    const toolbar = screen.getByTestId("plants-tab-toolbar");
    expect(within(toolbar).getByTestId("button-download-plants")).toBeInTheDocument();
    expect(within(toolbar).getByTestId("button-import-plants")).toBeInTheDocument();
    expect(within(toolbar).getByTestId("button-filter-menu-trigger")).toBeInTheDocument();'''),
    ('artifacts/studio/src/__tests__/Workspace.Jade.test.tsx',
     '''    fireEvent.click(screen.getByTestId("button-add-plant-row"));
    fireEvent.change(screen.getByTestId("input-new-plant-city"), { target: { value: "Dallas" } });
    fireEvent.change(screen.getByTestId("input-new-plant-state"), { target: { value: "TX" } });
    fireEvent.change(screen.getByTestId("input-new-plant-lat"), { target: { value: "32.78" } });
    fireEvent.change(screen.getByTestId("input-new-plant-lng"), { target: { value: "-96.8" } });
    fireEvent.click(screen.getByTestId("button-add-plant-confirm"));
''',
     '''    fireEvent.click(screen.getByTestId("button-add-plant-row"));
    fireEvent.change(screen.getByTestId("create-entity-city"), { target: { value: "Dallas" } });
    fireEvent.change(screen.getByTestId("create-entity-state"), { target: { value: "TX" } });
    fireEvent.change(screen.getByTestId("create-entity-lat"), { target: { value: "32.78" } });
    fireEvent.change(screen.getByTestId("create-entity-lng"), { target: { value: "-96.8" } });
    fireEvent.click(screen.getByTestId("create-entity-submit"));
'''),
    ('artifacts/studio/src/pages/Workspace.tsx',
     '''        <PlantsTab
''',
     '''        <PlantsTab
          readOnly={isBrowsingHistoryNow}
'''),
    ('artifacts/studio/src/__tests__/historyReadOnlyTabs.test.ts',
     '''  PlantsTab: "pending", // SCU-2.P4.12''',
     '''  PlantsTab: "readOnly", // SCU-2.P4.12'''),
]
for path, old, new in EDITS:
    f = pathlib.Path(path)
    s = f.read_text()
    n = s.count(old)
    if n != 1:
        raise SystemExit(f'STOP: {path}: anchor found {n} times (expected 1): {old[:80]!r}')
    f.write_text(s.replace(old, new, 1))
print(f'applied {len(EDITS)} edits')
PY
```

- [ ] **Step 6: Run the task's tests**

Run: `pnpm --filter studio exec vitest run src/__tests__/PlantsTab.dataTable.test.tsx src/__tests__/PlantsTab.test.tsx src/__tests__/Workspace.Jade.test.tsx src/__tests__/historyReadOnlyTabs.test.ts`
Expected: PASS — 46 tests in 4 files (measured at plan time). Then `pnpm --filter studio typecheck` → exit 0.

- [ ] **Step 7: e2e sweep, rewrites and local run**

Sweep (matrix §3 prefixes for this instance; `labs.spec.ts` excluded):
```bash
grep -rn -E 'plants-tab|added-plants-|row-added-plant-|button-add-plant-|input-new-plant-|button-export-plants|button-import-plants' artifacts/studio/e2e --include='*.ts' | grep -v labs.spec.ts
```
Rewritten below: the inline plant add → modal. Unchanged: `plants-tab`, `added-plants-section`, `row-added-plant-*`, `button-add-plant-row`.

Apply the rewrites (each anchor is asserted unique; verified against the Bundle 1 tip `e2e/` tree and type-checked at plan time):

```bash
python3 - <<'PY'
import pathlib
EDITS = [
    ('artifacts/studio/e2e/workspace-fixups-2.spec.ts',
     '''      await page.getByTestId("button-add-plant-row").click();
      await page.getByTestId("input-new-plant-city").fill("Testburg");
      await page.getByTestId("input-new-plant-state").fill("ZZ");
      await page.getByTestId("input-new-plant-lat").fill("41.0");
      await page.getByTestId("input-new-plant-lng").fill("-80.0");
      await page.getByTestId("button-add-plant-confirm").click();''',
     '''      // SCU-2.P4.12 (B2.8) — "+ Add plant" opens the CreateEntityDialog modal.
      await page.getByTestId("button-add-plant-row").click();
      await expect(page.getByTestId("create-entity-dialog")).toBeVisible({ timeout: HEADER_TIMEOUT });
      await page.getByTestId("create-entity-city").fill("Testburg");
      await page.getByTestId("create-entity-state").fill("ZZ");
      await page.getByTestId("create-entity-lat").fill("41.0");
      await page.getByTestId("create-entity-lng").fill("-80.0");
      await page.getByTestId("create-entity-submit").click();
      await expect(page.getByTestId("create-entity-dialog")).toHaveCount(0, { timeout: HEADER_TIMEOUT });'''),
]
for path, old, new in EDITS:
    f = pathlib.Path(path)
    s = f.read_text()
    n = s.count(old)
    if n != 1:
        raise SystemExit(f'STOP: {path}: anchor found {n} times (expected 1): {old[:80]!r}')
    f.write_text(s.replace(old, new, 1))
print(f'applied {len(EDITS)} edits')
PY
```

Then `pnpm --filter studio typecheck:e2e` (exit 0) and, with both local servers up (Global Constraints), run
```bash
cd artifacts/studio && E2E_BASE_URL=http://localhost:5179 npx playwright test e2e/workspace-fixups.spec.ts e2e/workspace-fixups-2.spec.ts
```
Expected: every test passes (a failure → flake registry by test name, two isolated re-runs, before calling it a regression). Record per-spec pass/fail in the changelog entry.

- [ ] **Step 8: Gate**

Run each separately (Global Constraints):
1. `cnt=$(ps aux | grep "[v]itest" | grep -v "zsh -c" | wc -l | tr -d ' '); [ "$cnt" = "0" ]`
2. `pnpm run typecheck`
3. `pnpm --filter studio typecheck:e2e`
4. `DATABASE_URL="postgresql://shubhamkr@localhost:5432/nos_dev" pnpm --filter api-server test`
5. `pnpm --filter studio test`
6. `(cd artifacts/api-server/src/solver && python3 -m pytest tests/ -x)`
7. `pnpm --filter @workspace/import-schema test`

Expected: every command exits 0. Then `git diff --stat "$P3_TIP"..HEAD -- artifacts/api-server lib/db lib/api-spec` prints nothing.

- [ ] **Step 9: Changelog**

Append to the bottom of `docs/CHANGELOG-implementation.md`:

```markdown

### SCU-2.P4.12 — JADE Plants on DataTable

- JADE Plants on DataTable: one shared FilterMenu over base + added (user decision), "+ Add plant" modal, D2 read-only (new prop), Upload ▾/Download ▾, numbers centred.
- Deviations 1, 3, 9, 13, 15, 17.
- Gate: studio <N passed>, api-server <N passed>, pytest <N passed>, import-schema <N passed>. e2e (local, `E2E_BASE_URL` set): <spec: pass/fail per spec>.
```

Replace each `<…>` with the value measured in this run, or the literal `unknown`.

- [ ] **Step 10: Commit**

```bash
git add artifacts/studio/src/__tests__/PlantsTab.dataTable.test.tsx
```

```bash
[ "$(git rev-parse --abbrev-ref HEAD)" != "main" ] || exit 1
```

```bash
git commit artifacts/studio/src/__tests__/PlantsTab.dataTable.test.tsx artifacts/studio/src/components/workspace/tabs/PlantsTab.tsx artifacts/studio/src/__tests__/PlantsTab.test.tsx artifacts/studio/src/__tests__/Workspace.Jade.test.tsx artifacts/studio/src/pages/Workspace.tsx artifacts/studio/src/__tests__/historyReadOnlyTabs.test.ts artifacts/studio/e2e/workspace-fixups-2.spec.ts docs/CHANGELOG-implementation.md -m "[SCU-2.P4.12] move JADE Plants onto DataTable with one shared filter and the add modal" -m "Base + added share one FilterMenu (user decision), +Add plant modal, D2 read-only, Upload/Download menus. One commit for #25-#26 (dev 1). Deviations 1, 3, 9, 13, 15, 17." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task SCU-2.P4.13: Mines on DataTable with the +Add modal (transport-coal)

**Owner role:** frontend-engineer. **Matrix:** §1 #27–#28, §2c Mines base + added. **Spec:** B2.1–B2.4, B2.8, D2. **Deviations:** 1, 3, 9, 13, 15, 17, 18.

**Files:**
- Create: `artifacts/studio/src/__tests__/MinesTab.dataTable.test.tsx`
- Modify: `artifacts/studio/src/components/workspace/tabs/MinesTab.tsx`
- Modify: `artifacts/studio/src/__tests__/MinesTab.test.tsx`
- Modify: `artifacts/studio/src/__tests__/Workspace.test.tsx`
- Modify: `artifacts/studio/src/__tests__/Workspace.TransportCoal.test.tsx`
- Modify: `artifacts/studio/src/pages/Workspace.tsx`
- Modify: `artifacts/studio/src/__tests__/historyReadOnlyTabs.test.ts`
- Modify: `docs/CHANGELOG-implementation.md` (append `### SCU-2.P4.13`)

**Interfaces:**
- Consumes: P4.10 `entityCells` (`DraftNumberInput`, `DeleteRowButton`); P4.2 modal (`entityKind: "mine"`).
- Produces: `MinesTab` prop `readOnly?: boolean`; new pager ids `button-mines-prev/next`, `mines-page-indicator`.

**Behaviour changes (record each in the changelog):**
- "+ Add mine" opens the modal (capacity, no status).
- History read-only on base + added capacity, delete, add trigger (D2 — no prop before).
- FilterMenu above 10 rows; Upload ▾ / Download ▾; numbers centred.

- [ ] **Step 0: Invoke the simplicity skills**

Skill tool: `andrej-karpathy-skills:karpathy-guidelines`, then `ponytail:ponytail`. Record in the report that both ran (hard rule #12).

- [ ] **Step 1: Preconditions**

Run each line alone (worktree root):
```bash
cd /Users/shubhamkr/nos-scu-2.p4.13 && git rev-parse --abbrev-ref HEAD
git merge-base --is-ancestor "$BASE" HEAD || exit 1
git merge-base --is-ancestor "$B1_TIP" HEAD || exit 1
git merge-base --is-ancestor "$P3_TIP" HEAD || exit 1
test -f artifacts/studio/src/components/data-table/DataTable.tsx && test -f artifacts/studio/src/components/data-table/DownloadMenu.tsx && test -d lib/import-schema || exit 1
pnpm install --frozen-lockfile
```
Then confirm the files this task replaces wholesale are still the `46d2f98` text (Global Constraints):
```bash
git diff --quiet 46d2f98 HEAD -- artifacts/studio/src/components/workspace/tabs/MinesTab.tsx || { echo 'STOP: artifacts/studio/src/components/workspace/tabs/MinesTab.tsx changed since 46d2f98'; exit 1; }
```

- [ ] **Step 2: Write the failing test**

Create `artifacts/studio/src/__tests__/MinesTab.dataTable.test.tsx`:

```bash
mkdir -p artifacts/studio/src/__tests__ && cat > artifacts/studio/src/__tests__/MinesTab.dataTable.test.tsx <<'SCU_EOF'
// SCU-2.P4.13 — transport-coal Mines on the shared DataTable (spec B2.1–B2.4,
// B2.8, D2): matrix testids, history read-only on base AND added (no disabled
// prop existed), the "+ Add mine" modal, one capacity round-trip.

import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { AllProviders } from "@/__tests__/helpers/renderWithExportProvider";
import { MinesTab, type AddedMine } from "@/components/workspace/tabs/MinesTab";
import type { MineOverride } from "@/components/tables/MineTable";

const mines = [
  { id: "KY", city: "Pikeville", state: "KY", lat: 37.5, lng: -82.5 },
  { id: "WV", city: "Beckley", state: "WV", lat: 37.8, lng: -81.2 },
];
const added: AddedMine[] = [{ id: "am-1", city: "Bristol", state: "VA", lat: 36.6, lng: -82.19, capacity: 1000, displayCode: "MN-VA-BRISTOL-01" }];

const renderTab = (props: Partial<React.ComponentProps<typeof MinesTab>> = {}) =>
  render(<MinesTab mines={mines} overrides={[]} onChange={vi.fn()} scenarioId={1} addedMines={added} onAddedMinesChange={vi.fn()} onDeleteMine={vi.fn()} {...props} />, {
    wrapper: AllProviders,
  });

describe("MinesTab on DataTable (SCU-2.P4.13)", () => {
  it("emits every testid in the matrix map; headers unchanged", () => {
    renderTab();
    for (const id of ["mines-tab", "mines-tab-toolbar", "button-import-mines", "button-download-mines", "button-add-mine-row", "input-mine-capacity-KY", "added-mines-section", "row-added-mine-am-1", "input-added-mine-capacity-am-1", "button-delete-added-mine-am-1"]) {
      expect(screen.getByTestId(id)).toBeInTheDocument();
    }
    expect(screen.getByTestId("input-mine-capacity-KY")).toHaveAttribute("placeholder", "base capacity");
    expect(screen.getByTestId("input-added-mine-capacity-am-1")).toHaveValue(1000);
    expect(screen.getAllByRole("columnheader").map(h => h.textContent).slice(0, 6)).toEqual(["ID", "City", "State", "Latitude", "Longitude", "Capacity override (tons)"]);
  });

  it("history read-only (D2): base + added capacity, delete and the add trigger are disabled", () => {
    renderTab({ readOnly: true });
    for (const id of ["input-mine-capacity-KY", "input-added-mine-capacity-am-1", "button-delete-added-mine-am-1", "button-add-mine-row"]) {
      expect(screen.getByTestId(id)).toBeDisabled();
    }
  });

  it("+ Add mine: the modal has Capacity, no status; submit appends an am- mine", () => {
    const onAdded = vi.fn();
    renderTab({ onAddedMinesChange: onAdded });
    fireEvent.click(screen.getByTestId("button-add-mine-row"));
    const d = screen.getByTestId("create-entity-dialog");
    expect(within(d).queryByTestId("create-entity-status")).toBeNull();
    for (const [id, v] of [["create-entity-city", "Pikeville"], ["create-entity-state", "KY"], ["create-entity-lat", "37.54"], ["create-entity-lng", "-82.75"], ["create-entity-capacity", "25000000"]] as const) {
      fireEvent.change(within(d).getByTestId(id), { target: { value: v } });
    }
    fireEvent.click(within(d).getByTestId("create-entity-submit"));
    const next = onAdded.mock.calls[0]![0] as AddedMine[];
    expect(next[1]!.id).toMatch(/^am-/);
    expect(next[1]).toMatchObject({ city: "Pikeville", capacity: 25000000, displayCode: "MN-KY-PIKEVILLE-01" });
  });

  it("capacity round-trip: a base override appears and clears", () => {
    function Parent() {
      const [o, setO] = useState<MineOverride[]>([]);
      return <MinesTab mines={mines} overrides={o} onChange={setO} />;
    }
    render(<Parent />, { wrapper: AllProviders });
    fireEvent.change(screen.getByTestId("input-mine-capacity-KY"), { target: { value: "5000" } });
    expect(screen.getByTestId("input-mine-capacity-KY")).toHaveValue(5000);
    fireEvent.change(screen.getByTestId("input-mine-capacity-KY"), { target: { value: "" } });
    expect(screen.getByTestId("input-mine-capacity-KY")).toHaveValue(null);
  });
});
SCU_EOF
```

- [ ] **Step 3: Run it to verify it fails**

Run: `pnpm --filter studio exec vitest run src/__tests__/MinesTab.dataTable.test.tsx`
Expected: FAIL — `Tests  3 failed | 1 passed (4)` (measured at plan time against the pre-migration tab) — the history test finds enabled controls (and `readOnly` is not yet a prop — a type error under `pnpm --filter studio typecheck`), and the menu/filter/centring assertions find today's single buttons, From/To boxes and left-aligned numbers.

- [ ] **Step 4: Implement — `MinesTab.tsx`**

Replace the whole file `artifacts/studio/src/components/workspace/tabs/MinesTab.tsx` with:

```bash
mkdir -p artifacts/studio/src/components/workspace/tabs && cat > artifacts/studio/src/components/workspace/tabs/MinesTab.tsx <<'SCU_EOF'
import { useState } from "react";
import type { Scenario } from "@workspace/api-client-react";
import type { MineOverride } from "@/components/tables/MineTable";
import { Button } from "@/components/ui/button";
import { AlertTriangle } from "lucide-react";
import { completenessCountForMine, idCollisionMessageForMine, type PrecheckErrorLike } from "@/lib/precheckDisplay";
import { CreateEntityDialog } from "@/components/workspace/map/dialogs/CreateEntityDialog";
import { DataTable } from "@/components/data-table/DataTable";
import type { ColumnDef } from "@/components/data-table/types";
import { useEntityFileMenus } from "@/components/data-table/useEntityFileMenus";
import { DeleteRowButton, DraftNumberInput, READ_ONLY_TITLE } from "@/components/data-table/entityCells";

interface MineRow {
  id: string;
  city: string;
  state: string;
  lat: number;
  lng: number;
  zip?: string;
}

// Task 30 (B6.1 stage 4) — matches `addedMineSchema` in
// artifacts/api-server/src/validation/inputs/transportLp.ts exactly. No
// `status` field: mines have no forced-open/inactive concept anywhere in
// this LP (stage 1-3's own report, confirmed against solve_transport and
// mines.json) — a "closed" mine is a capacity override of 0, same precedent
// templates.ts's MineOverride comment already documents. `capacity` stays
// nullable/optional — a blank capacity on an added mine is a deliberate,
// valid "unconstrained" state (matches solve.py's get_base_capacity
// None-means-unconstrained convention), NOT a required field.
// T11 (Input Map v2 identity model, Step A) — `id` is now a hidden T3
// stable uid (`am-<uuid>`, minted via `newUid("mn")`), never typed;
// `displayCode` is the human-facing, collision-checked label, matching
// WarehousesTab.tsx's own T9 migration exactly.
export interface AddedMine {
  id: string;
  city: string;
  state: string;
  lat: number;
  lng: number;
  capacity?: number | null;
  displayCode?: string;
}

interface MinesTabProps {
  mines: MineRow[];
  overrides: MineOverride[];
  onChange: (next: MineOverride[]) => void;
  /** Undefined while the scenario hasn't resolved yet — Upload/Download stay disabled until it has. */
  scenarioId?: number;
  /** Fired after a successful import apply, with the updated scenario — the caller (Workspace.tsx) refreshes its inputs draft from it. */
  onImportApplied?: (scenario: Scenario) => void;
  /** Task 30 — scenario-local addedMines. Fired on both add (append) and in-row capacity edits — full replacement array, same `onChange`-out convention as every other tab. */
  addedMines?: AddedMine[];
  onAddedMinesChange?: (next: AddedMine[]) => void;
  /** Fired on delete only — kept separate from onAddedMinesChange because the caller (Workspace.tsx) also needs to purge any laneCostOverrides referencing this id in the SAME atomic inputs update, same pattern B5.2 established for warehouses/customers + distanceOverrides. */
  onDeleteMine?: (id: string) => void;
  /** B6.1 stage 3's precheck errors for the current scenario — drives the inline "missing N lane costs" chip on added rows. Undefined/omitted degrades to "no warnings shown", never a crash. */
  precheckErrors?: PrecheckErrorLike[];
  /** SCU-2.P4.13 (D2) — browsing result history: base and added capacity,
   * delete and the "+ Add mine" trigger are disabled (no disabled prop before). */
  readOnly?: boolean;
}

/** One effective row: a base mine with its capacity override, or an added mine. */
interface MineTableRow {
  id: string;
  displayId: string;
  city: string;
  state: string;
  lat: number;
  lng: number;
  zip?: string;
  /** Base: the override only (blank = base capacity); added: the stored value (blank = unconstrained). */
  capacity: number | null | undefined;
  added: boolean;
}

// Task 30 → SCU-2.P4.13 (spec B2.1–B2.4, B2.8, D2) — transport-coal's Mines
// tab on the shared DataTable: base and added mines are two sections under
// ONE toolbar (Upload ▾, Download ▾, "+ Add mine" modal, FilterMenu above 10
// rows) and one pager. The legacy `MineTable` is no longer rendered here.
export function MinesTab({
  mines,
  overrides,
  onChange,
  scenarioId,
  onImportApplied,
  addedMines = [],
  onAddedMinesChange,
  onDeleteMine,
  precheckErrors = [],
  readOnly = false,
}: MinesTabProps) {
  const files = useEntityFileMenus({
    entity: "mines",
    testIdEntity: "mines",
    modelId: "transport-coal",
    scenarioId,
    onImportApplied,
  });
  const [adding, setAdding] = useState(false);

  function upsertBase(id: string, capacity: number | null) {
    if (readOnly) return;
    const rest = overrides.filter(o => o.id !== id);
    onChange(capacity == null ? rest : [...rest, { id, capacity }]);
  }
  function upsertAdded(id: string, capacity: number | null) {
    if (readOnly) return;
    onAddedMinesChange?.(addedMines.map(m => (m.id === id ? { ...m, capacity } : m)));
  }

  const rows: MineTableRow[] = [
    ...mines.map(m => ({ ...m, displayId: m.id, capacity: overrides.find(o => o.id === m.id)?.capacity, added: false })),
    ...addedMines.map(m => ({
      id: m.id,
      displayId: m.displayCode ?? m.id,
      city: m.city,
      state: m.state,
      lat: m.lat,
      lng: m.lng,
      capacity: m.capacity,
      added: true,
    })),
  ];

  const location = (added: boolean): ColumnDef<MineTableRow>[] => [
    {
      id: "id",
      header: "ID",
      kind: "text",
      filter: "text",
      value: r => r.displayId,
      cellClassName: "font-mono text-xs",
      cell: r => {
        if (!added) return r.displayId;
        const missing = completenessCountForMine(precheckErrors, r.id);
        const collision = idCollisionMessageForMine(precheckErrors, r.id);
        return (
          <div className="flex items-center gap-1">
            {r.displayId}
            {(missing != null || collision) && (
              <span
                title={
                  collision ??
                  `Missing lane costs to ${missing} station${missing === 1 ? "" : "s"} — see the Lane costs tab, or download/upload a template.`
                }
                data-testid={`warning-precheck-added-mine-${r.id}`}
                className="inline-flex items-center gap-0.5 text-[10px] text-amber-700 bg-amber-100 border border-amber-300 rounded px-1"
              >
                <AlertTriangle className="w-3 h-3" />
                {collision ? "ID collision" : `Missing ${missing} lane cost${missing === 1 ? "" : "s"}`}
              </span>
            )}
          </div>
        );
      },
    },
    { id: "city", header: "City", kind: "text", filter: "text", value: r => r.city, cellClassName: "text-xs", cell: r => r.city },
    {
      id: "state",
      header: "State",
      kind: "text",
      filter: "text",
      value: r => r.state || null,
      cellClassName: "text-xs",
      cell: r => r.state,
    },
    {
      id: "lat",
      header: "Latitude",
      kind: "number",
      value: r => r.lat,
      cellClassName: "text-xs font-mono",
      cell: r => r.lat.toFixed(4),
    },
    {
      id: "lng",
      header: "Longitude",
      kind: "number",
      value: r => r.lng,
      cellClassName: "text-xs font-mono",
      cell: r => r.lng.toFixed(4),
    },
  ];
  const capacity = (added: boolean): ColumnDef<MineTableRow> => ({
    id: "capacity",
    header: added ? "Capacity" : "Capacity override (tons)",
    filterLabel: "Capacity",
    kind: "number",
    value: r => r.capacity ?? null,
    cell: r => (
      <DraftNumberInput
        value={r.capacity}
        // base: integer (MineTable's parseInt); added: decimal (the added section's parseFloat)
        parse={raw => (raw === "" ? null : Math.max(0, (added ? parseFloat(raw) : parseInt(raw, 10)) || 0))}
        onCommit={v => (added ? upsertAdded(r.id, v) : upsertBase(r.id, v))}
        disabled={readOnly}
        placeholder={added ? "unconstrained" : "base capacity"}
        testId={added ? `input-added-mine-capacity-${r.id}` : `input-mine-capacity-${r.id}`}
      />
    ),
  });
  const hasZip = mines.some(m => m.zip);
  const baseColumns: ColumnDef<MineTableRow>[] = [
    ...location(false),
    ...(hasZip
      ? [
          {
            id: "zip",
            header: "Zip",
            kind: "text",
            filter: "text",
            value: r => r.zip ?? null,
            cellClassName: "text-xs font-mono",
            cell: r => r.zip ?? "—",
          } satisfies ColumnDef<MineTableRow>,
        ]
      : []),
    capacity(false),
  ];
  const addedColumns: ColumnDef<MineTableRow>[] = [
    ...location(true),
    capacity(true),
    {
      id: "delete",
      header: "",
      kind: "text",
      filter: false,
      value: () => null,
      cell: r => (
        <DeleteRowButton
          label={`Delete added mine ${r.id}`}
          onClick={() => onDeleteMine?.(r.id)}
          disabled={readOnly}
          testId={`button-delete-added-mine-${r.id}`}
        />
      ),
    },
  ];

  const addTrigger = onAddedMinesChange != null && (
    <Button
      size="sm"
      variant="outline"
      className="h-7 px-2 text-xs"
      onClick={() => setAdding(true)}
      disabled={readOnly}
      title={readOnly ? READ_ONLY_TITLE : undefined}
      data-testid="button-add-mine-row"
    >
      + Add mine
    </Button>
  );

  return (
    <div data-testid="mines-tab">
      <DataTable<MineTableRow>
        rows={rows}
        rowKey={r => `${r.added ? "added" : "base"}:${r.id}`}
        columns={baseColumns}
        ctx={{ readOnly, demandEditable: false, isAdded: r => r.added }}
        testIds={{
          toolbar: "mines-tab-toolbar",
          pagerPrev: "button-mines-prev",
          pagerNext: "button-mines-next",
          pageIndicator: "mines-page-indicator",
        }}
        toolbar={{ upload: files.upload, download: files.download, add: addTrigger }}
        sections={[
          {
            id: "base",
            includes: r => !r.added,
            scrollClassName: "max-h-[60vh] overflow-y-auto",
            emptyState: (
              <p className="text-sm text-muted-foreground" data-testid="mines-tab-empty">
                No mines in this dataset.
              </p>
            ),
          },
          ...(onAddedMinesChange != null
            ? [
                {
                  id: "added",
                  title: "Added mines",
                  testId: "added-mines-section",
                  includes: (r: MineTableRow) => r.added,
                  columns: addedColumns,
                  rowTestId: (r: MineTableRow) => `row-added-mine-${r.id}`,
                  scrollClassName: "max-h-[40vh] overflow-y-auto",
                  emptyState: (
                    <p className="text-xs text-muted-foreground" data-testid="added-mines-empty">
                      No added mines yet — use "+ Add mine" above to create one.
                    </p>
                  ),
                },
              ]
            : []),
        ]}
      />
      {adding && (
        <CreateEntityDialog
          source="table"
          entityKind="mine"
          existingCodes={addedMines.map(m => m.displayCode).filter((c): c is string => !!c)}
          onCreate={r => {
            if (r.kind === "mine") onAddedMinesChange?.([...addedMines, r.entity]);
            setAdding(false);
          }}
          onCancel={() => setAdding(false)}
        />
      )}
      {files.dialog}
    </div>
  );
}
SCU_EOF
```

- [ ] **Step 5: Wire Workspace, flip the D2 guard, rewrite the by-design test breaks**

Adds `readOnly={isBrowsingHistoryNow}` to the `<MinesTab` mount, flips the guard, rewrites `MinesTab.test.tsx` (menus, modal), `Workspace.test.tsx` (modal ids) and `Workspace.TransportCoal.test.tsx` (Download ▾ trigger):

```bash
python3 - <<'PY'
import pathlib
EDITS = [
    ('artifacts/studio/src/__tests__/MinesTab.test.tsx',
     '''import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MinesTab } from "@/components/workspace/tabs/MinesTab";

const mines = [''',
     '''import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MinesTab } from "@/components/workspace/tabs/MinesTab";
import { chooseInputDownload, chooseUpload } from "@/__tests__/helpers/inputTable";

const mines = ['''),
    ('artifacts/studio/src/__tests__/MinesTab.test.tsx',
     '''      </ExportProviderTestWrapper>,
    );
    expect(screen.getByTestId("button-export-mines-csv")).toBeDisabled();
    expect(screen.getByTestId("button-export-mines-json")).toBeDisabled();
    expect(screen.getByTestId("button-import-mines")).toBeDisabled();
  });''',
     '''      </ExportProviderTestWrapper>,
    );
    // SCU-2.P4 (B2.3/B2.4) — one Download ▾ trigger now carries the disabled state.
    expect(screen.getByTestId("button-download-mines")).toBeDisabled();
    expect(screen.getByTestId("button-import-mines")).toBeDisabled();
  });'''),
    ('artifacts/studio/src/__tests__/MinesTab.test.tsx',
     '''    );

    await userEvent.click(screen.getByTestId("button-export-mines-csv"));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());''',
     '''    );

    chooseInputDownload("mines", "csv");

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());'''),
    ('artifacts/studio/src/__tests__/MinesTab.test.tsx',
     '''    renderWithQueryClient(<MinesTab mines={mines} overrides={[]} onChange={vi.fn()} scenarioId={7} />);
    expect(screen.queryByText("Import mines")).not.toBeInTheDocument();
    await userEvent.click(screen.getByTestId("button-import-mines"));
    expect(screen.getByText("Import mines")).toBeInTheDocument();
    expect(screen.getByTestId("input-import-file-mines")).toBeInTheDocument();''',
     '''    renderWithQueryClient(<MinesTab mines={mines} overrides={[]} onChange={vi.fn()} scenarioId={7} />);
    expect(screen.queryByText("Import mines")).not.toBeInTheDocument();
    chooseUpload("mines", "csv");
    expect(screen.getByText("Import mines")).toBeInTheDocument();
    expect(screen.getByTestId("input-import-file-mines")).toBeInTheDocument();'''),
    ('artifacts/studio/src/__tests__/MinesTab.test.tsx',
     '    );\n\n    await userEvent.click(screen.getByTestId("button-import-mines"));\n    const file = new File(["id,capacity\\nM1,5000"], "mines.csv", { type: "text/csv" });\n    await userEvent.upload(screen.getByTestId("input-import-file-mines"), file);',
     '    );\n\n    chooseUpload("mines", "csv");\n    const file = new File(["id,capacity\\nM1,5000"], "mines.csv", { type: "text/csv" });\n    await userEvent.upload(screen.getByTestId("input-import-file-mines"), file);'),
    ('artifacts/studio/src/__tests__/MinesTab.test.tsx',
     '''
    await userEvent.click(screen.getByTestId("button-add-mine-row"));
    await userEvent.type(screen.getByTestId("input-new-mine-city"), "Denver");
    await userEvent.type(screen.getByTestId("input-new-mine-state"), "CO");
    await userEvent.type(screen.getByTestId("input-new-mine-lat"), "39.74");
    await userEvent.type(screen.getByTestId("input-new-mine-lng"), "-104.99");
    await userEvent.type(screen.getByTestId("input-new-mine-capacity"), "5000000");
    await userEvent.click(screen.getByTestId("button-add-mine-confirm"));

    expect(onAddedMinesChange).toHaveBeenCalledTimes(1);''',
     '''
    await userEvent.click(screen.getByTestId("button-add-mine-row"));
    await userEvent.type(screen.getByTestId("create-entity-city"), "Denver");
    await userEvent.type(screen.getByTestId("create-entity-state"), "CO");
    await userEvent.type(screen.getByTestId("create-entity-lat"), "39.74");
    await userEvent.type(screen.getByTestId("create-entity-lng"), "-104.99");
    await userEvent.type(screen.getByTestId("create-entity-capacity"), "5000000");
    await userEvent.click(screen.getByTestId("create-entity-submit"));

    expect(onAddedMinesChange).toHaveBeenCalledTimes(1);'''),
    ('artifacts/studio/src/__tests__/MinesTab.test.tsx',
     '''
    await userEvent.click(screen.getByTestId("button-add-mine-row"));
    await userEvent.type(screen.getByTestId("input-new-mine-city"), "Denver");
    await userEvent.type(screen.getByTestId("input-new-mine-state"), "CO");
    await userEvent.type(screen.getByTestId("input-new-mine-lat"), "39.74");
    await userEvent.type(screen.getByTestId("input-new-mine-lng"), "-104.99");
    // Capacity left blank on purpose.
    await userEvent.click(screen.getByTestId("button-add-mine-confirm"));

    expect(onAddedMinesChange).toHaveBeenCalledTimes(1);''',
     '''
    await userEvent.click(screen.getByTestId("button-add-mine-row"));
    await userEvent.type(screen.getByTestId("create-entity-city"), "Denver");
    await userEvent.type(screen.getByTestId("create-entity-state"), "CO");
    await userEvent.type(screen.getByTestId("create-entity-lat"), "39.74");
    await userEvent.type(screen.getByTestId("create-entity-lng"), "-104.99");
    // Capacity left blank on purpose.
    await userEvent.click(screen.getByTestId("create-entity-submit"));

    expect(onAddedMinesChange).toHaveBeenCalledTimes(1);'''),
    ('artifacts/studio/src/__tests__/MinesTab.test.tsx',
     '''    expect(added).toMatchObject({ city: "Denver", state: "CO", lat: 39.74, lng: -104.99, capacity: null });
    expect(added.id).toMatch(/^am-/);
    expect(screen.queryByTestId("text-add-mine-error")).not.toBeInTheDocument();
  });
''',
     '''    expect(added).toMatchObject({ city: "Denver", state: "CO", lat: 39.74, lng: -104.99, capacity: null });
    expect(added.id).toMatch(/^am-/);
    expect(screen.queryByTestId("create-entity-error")).not.toBeInTheDocument();
  });
'''),
    ('artifacts/studio/src/__tests__/MinesTab.test.tsx',
     '''
    await userEvent.click(screen.getByTestId("button-add-mine-row"));
    await userEvent.type(screen.getByTestId("input-new-mine-city"), "Chicago");
    await userEvent.type(screen.getByTestId("input-new-mine-state"), "IL");
    fireEvent.blur(screen.getByTestId("input-new-mine-state"));
    await userEvent.clear(screen.getByTestId("input-new-mine-display-code"));
    await userEvent.type(screen.getByTestId("input-new-mine-display-code"), "DUPE");
    await userEvent.click(screen.getByTestId("button-add-mine-confirm"));

    expect(onAddedMinesChange).not.toHaveBeenCalled();
    expect(screen.getByTestId("text-add-mine-error")).toBeInTheDocument();
  });
''',
     '''
    await userEvent.click(screen.getByTestId("button-add-mine-row"));
    await userEvent.type(screen.getByTestId("create-entity-city"), "Chicago");
    await userEvent.type(screen.getByTestId("create-entity-state"), "IL");
    fireEvent.blur(screen.getByTestId("create-entity-state"));
    await userEvent.clear(screen.getByTestId("create-entity-display-code"));
    await userEvent.type(screen.getByTestId("create-entity-display-code"), "DUPE");
    await userEvent.click(screen.getByTestId("create-entity-submit"));

    expect(onAddedMinesChange).not.toHaveBeenCalled();
    expect(screen.getByTestId("create-entity-error")).toBeInTheDocument();
  });
'''),
    ('artifacts/studio/src/__tests__/MinesTab.test.tsx',
     '''    expect(screen.getByTestId("mines-tab")).toBeInTheDocument();
    expect(screen.getByTestId("mines-tab-toolbar")).toBeInTheDocument();
    expect(screen.getByTestId("button-export-mines-csv")).toBeInTheDocument();
    expect(screen.getByTestId("button-import-mines")).toBeInTheDocument();
    expect(screen.getByText("M1")).toBeInTheDocument();''',
     '''    expect(screen.getByTestId("mines-tab")).toBeInTheDocument();
    expect(screen.getByTestId("mines-tab-toolbar")).toBeInTheDocument();
    expect(screen.getByTestId("button-download-mines")).toBeInTheDocument();
    expect(screen.getByTestId("button-import-mines")).toBeInTheDocument();
    expect(screen.getByText("M1")).toBeInTheDocument();'''),
    ('artifacts/studio/src/__tests__/MinesTab.test.tsx',
     '''      />,
    );
    expect(screen.queryByTestId("add-mine-row-form")).not.toBeInTheDocument();
    await userEvent.click(screen.getByTestId("button-add-mine-row"));
    expect(screen.getByTestId("add-mine-row-form")).toBeInTheDocument();
    expect(screen.getByTestId("mines-tab")).toBeInTheDocument();
    expect(screen.getByText("M1")).toBeInTheDocument();''',
     '''      />,
    );
    expect(screen.queryByTestId("create-entity-dialog")).not.toBeInTheDocument();
    await userEvent.click(screen.getByTestId("button-add-mine-row"));
    expect(screen.getByTestId("create-entity-dialog")).toBeInTheDocument();
    expect(screen.getByTestId("mines-tab")).toBeInTheDocument();
    expect(screen.getByText("M1")).toBeInTheDocument();'''),
    ('artifacts/studio/src/__tests__/Workspace.test.tsx',
     '''    // human-facing label. Mirrors the equivalent warehouse test exactly.
    fireEvent.change(screen.getByTestId("input-new-mine-city"), { target: { value: "Bristol" } });
    fireEvent.change(screen.getByTestId("input-new-mine-state"), { target: { value: "VA" } });
    fireEvent.change(screen.getByTestId("input-new-mine-lat"), { target: { value: "36.6" } });
    fireEvent.change(screen.getByTestId("input-new-mine-lng"), { target: { value: "-82.19" } });
    fireEvent.click(screen.getByTestId("button-add-mine-confirm"));
''',
     '''    // human-facing label. Mirrors the equivalent warehouse test exactly.
    fireEvent.change(screen.getByTestId("create-entity-city"), { target: { value: "Bristol" } });
    fireEvent.change(screen.getByTestId("create-entity-state"), { target: { value: "VA" } });
    fireEvent.change(screen.getByTestId("create-entity-lat"), { target: { value: "36.6" } });
    fireEvent.change(screen.getByTestId("create-entity-lng"), { target: { value: "-82.19" } });
    fireEvent.click(screen.getByTestId("create-entity-submit"));
'''),
    ('artifacts/studio/src/__tests__/Workspace.TransportCoal.test.tsx',
     '''    fireEvent.click(screen.getByTestId("sidebar-input-mines"));
    expect(screen.getByTestId("button-export-mines-csv")).toBeInTheDocument();
    expect(screen.getByTestId("button-import-mines")).toBeInTheDocument();''',
     '''    fireEvent.click(screen.getByTestId("sidebar-input-mines"));
    expect(screen.getByTestId("button-download-mines")).toBeInTheDocument();
    expect(screen.getByTestId("button-import-mines")).toBeInTheDocument();'''),
    ('artifacts/studio/src/pages/Workspace.tsx',
     '''        <MinesTab
''',
     '''        <MinesTab
          readOnly={isBrowsingHistoryNow}
'''),
    ('artifacts/studio/src/__tests__/historyReadOnlyTabs.test.ts',
     '''  MinesTab: "pending", // SCU-2.P4.13''',
     '''  MinesTab: "readOnly", // SCU-2.P4.13'''),
]
for path, old, new in EDITS:
    f = pathlib.Path(path)
    s = f.read_text()
    n = s.count(old)
    if n != 1:
        raise SystemExit(f'STOP: {path}: anchor found {n} times (expected 1): {old[:80]!r}')
    f.write_text(s.replace(old, new, 1))
print(f'applied {len(EDITS)} edits')
PY
```

- [ ] **Step 6: Run the task's tests**

Run: `pnpm --filter studio exec vitest run src/__tests__/MinesTab.dataTable.test.tsx src/__tests__/MinesTab.test.tsx src/__tests__/Workspace.TransportCoal.test.tsx src/__tests__/Workspace.test.tsx src/__tests__/historyReadOnlyTabs.test.ts`
Expected: PASS — 205 tests in 5 files (measured at plan time). Then `pnpm --filter studio typecheck` → exit 0.

- [ ] **Step 7: e2e sweep, rewrites and local run**

Sweep (matrix §3 prefixes for this instance; `labs.spec.ts` excluded):
```bash
grep -rn -E 'mines-tab|added-mines-|row-added-mine-|button-add-mine-|input-new-mine-|input-mine-capacity-|button-export-mines|button-import-mines' artifacts/studio/e2e --include='*.ts' | grep -v labs.spec.ts
```
No rewrite needed: `mines-tab`, `added-mines-section`, `row-added-mine-*`, `button-add-mine-row` visibility are unchanged; no spec drives the inline mine form.

Then `pnpm --filter studio typecheck:e2e` (exit 0) and, with both local servers up (Global Constraints), run
```bash
cd artifacts/studio && E2E_BASE_URL=http://localhost:5179 npx playwright test e2e/tab-coverage.spec.ts e2e/workspace-fixups-2.spec.ts e2e/bundle2-fastfollow.spec.ts
```
Expected: every test passes (a failure → flake registry by test name, two isolated re-runs, before calling it a regression). Record per-spec pass/fail in the changelog entry.

- [ ] **Step 8: Gate**

Run each separately (Global Constraints):
1. `cnt=$(ps aux | grep "[v]itest" | grep -v "zsh -c" | wc -l | tr -d ' '); [ "$cnt" = "0" ]`
2. `pnpm run typecheck`
3. `pnpm --filter studio typecheck:e2e`
4. `DATABASE_URL="postgresql://shubhamkr@localhost:5432/nos_dev" pnpm --filter api-server test`
5. `pnpm --filter studio test`
6. `(cd artifacts/api-server/src/solver && python3 -m pytest tests/ -x)`
7. `pnpm --filter @workspace/import-schema test`

Expected: every command exits 0. Then `git diff --stat "$P3_TIP"..HEAD -- artifacts/api-server lib/db lib/api-spec` prints nothing.

- [ ] **Step 9: Changelog**

Append to the bottom of `docs/CHANGELOG-implementation.md`:

```markdown

### SCU-2.P4.13 — Mines on DataTable with the +Add modal

- Mines on DataTable: base + added sections, "+ Add mine" modal, D2 read-only (new prop), FilterMenu, Upload ▾/Download ▾. Legacy `MineTable` no longer rendered by the Workspace.
- Deviations 1, 3, 9, 13, 15, 17, 18.
- Gate: studio <N passed>, api-server <N passed>, pytest <N passed>, import-schema <N passed>. e2e (local, `E2E_BASE_URL` set): <spec: pass/fail per spec>.
```

Replace each `<…>` with the value measured in this run, or the literal `unknown`.

- [ ] **Step 10: Commit**

```bash
git add artifacts/studio/src/__tests__/MinesTab.dataTable.test.tsx
```

```bash
[ "$(git rev-parse --abbrev-ref HEAD)" != "main" ] || exit 1
```

```bash
git commit artifacts/studio/src/__tests__/MinesTab.dataTable.test.tsx artifacts/studio/src/components/workspace/tabs/MinesTab.tsx artifacts/studio/src/__tests__/MinesTab.test.tsx artifacts/studio/src/__tests__/Workspace.test.tsx artifacts/studio/src/__tests__/Workspace.TransportCoal.test.tsx artifacts/studio/src/pages/Workspace.tsx artifacts/studio/src/__tests__/historyReadOnlyTabs.test.ts docs/CHANGELOG-implementation.md -m "[SCU-2.P4.13] move Mines onto DataTable with the add modal" -m "Base + added sections, +Add mine modal, D2 read-only, Upload/Download menus. One commit for #27-#28 (dev 1). Deviations 1, 3, 9, 13, 15, 17, 18." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task SCU-2.P4.14: Stations on DataTable with the integer demand cell and the +Add modal (transport-coal)

**Owner role:** frontend-engineer. **Matrix:** §1 #29–#30, §2c Stations base + added. **Spec:** B2.1–B2.4, B2.8, B2.9 (integer mode), D2; user decision 2026-10-17. **Deviations:** 1, 2, 3, 9, 10, 12, 13, 15, 17, 18.

**Files:**
- Create: `artifacts/studio/src/__tests__/StationsTab.dataTable.test.tsx`
- Modify: `artifacts/studio/src/components/workspace/tabs/StationsTab.tsx`
- Modify: `artifacts/studio/src/__tests__/StationsTab.test.tsx`
- Modify: `artifacts/studio/src/__tests__/Workspace.test.tsx`
- Modify: `artifacts/studio/src/__tests__/Workspace.TransportCoal.test.tsx`
- Modify: `artifacts/studio/src/pages/Workspace.tsx`
- Modify: `artifacts/studio/src/__tests__/historyReadOnlyTabs.test.ts`
- Modify: `docs/CHANGELOG-implementation.md` (append `### SCU-2.P4.14`)

**Interfaces:**
- Consumes: P4.11 `DemandCell` (`integer`); P4.2 modal (`entityKind: "station"`).
- Produces: `StationsTab` prop `readOnly?: boolean`; new pager ids `button-stations-prev/next`, `stations-page-indicator`; the D2 guard's "nothing pending" assertion.

**Behaviour changes (record each in the changelog):**
- Station demand (base override and added) is a grouped integer `FormattedNumberInput` ("." rejected, inputmode numeric, "tons" suffix — user answer, no aria-label); base stays blank when not overridden; an emptied added demand is not saved and reverts on blur (it committed 0).
- "+ Add station" opens the modal; empty demand blocks.
- History read-only on base + added demand, delete, add trigger (D2 — no prop before).
- FilterMenu above 10 rows; Upload ▾ / Download ▾; numbers centred.

- [ ] **Step 0: Invoke the simplicity skills**

Skill tool: `andrej-karpathy-skills:karpathy-guidelines`, then `ponytail:ponytail`. Record in the report that both ran (hard rule #12).

- [ ] **Step 1: Preconditions**

Run each line alone (worktree root):
```bash
cd /Users/shubhamkr/nos-scu-2.p4.14 && git rev-parse --abbrev-ref HEAD
git merge-base --is-ancestor "$BASE" HEAD || exit 1
git merge-base --is-ancestor "$B1_TIP" HEAD || exit 1
git merge-base --is-ancestor "$P3_TIP" HEAD || exit 1
test -f artifacts/studio/src/components/data-table/DataTable.tsx && test -f artifacts/studio/src/components/data-table/DownloadMenu.tsx && test -d lib/import-schema || exit 1
pnpm install --frozen-lockfile
```
Then confirm the files this task replaces wholesale are still the `46d2f98` text (Global Constraints):
```bash
git diff --quiet 46d2f98 HEAD -- artifacts/studio/src/components/workspace/tabs/StationsTab.tsx || { echo 'STOP: artifacts/studio/src/components/workspace/tabs/StationsTab.tsx changed since 46d2f98'; exit 1; }
```

- [ ] **Step 2: Write the failing test**

Create `artifacts/studio/src/__tests__/StationsTab.dataTable.test.tsx`:

```bash
mkdir -p artifacts/studio/src/__tests__ && cat > artifacts/studio/src/__tests__/StationsTab.dataTable.test.tsx <<'SCU_EOF'
// SCU-2.P4.14 — transport-coal Stations on the shared DataTable with the B2.9
// demand cell in INTEGER mode (user decision 2026-10-17): grouped, "tons"
// suffix (user decision), "." rejected, no aria-label; empty base demand clears the override;
// empty added demand is not saved and reverts on blur; history read-only on
// base AND added (D2); the "+ Add station" modal.

import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { AllProviders } from "@/__tests__/helpers/renderWithExportProvider";
import { StationsTab, type AddedStation } from "@/components/workspace/tabs/StationsTab";
import type { StationOverride } from "@/components/tables/StationTable";

const stations = [
  { id: "LAX", city: "Los Angeles", state: "CA", lat: 33.97, lng: -118.25 },
  { id: "SEA", city: "Seattle", state: "WA", lat: 47.6, lng: -122.3 },
];
const added: AddedStation[] = [{ id: "as-1", city: "Newtown", state: "NC", lat: 35.5, lng: -80.2, demand: 900000, displayCode: "ST-NC-NEWTOWN-01" }];

const renderTab = (props: Partial<React.ComponentProps<typeof StationsTab>> = {}) =>
  render(
    <StationsTab stations={stations} overrides={[{ id: "SEA", demand: 1234567 }]} onChange={vi.fn()} scenarioId={1} addedStations={added} onAddedStationsChange={vi.fn()} onDeleteStation={vi.fn()} {...props} />,
    { wrapper: AllProviders },
  );

describe("StationsTab on DataTable (SCU-2.P4.14)", () => {
  it("emits every testid in the matrix map; base demand blank when not overridden, grouped when it is", () => {
    renderTab();
    for (const id of ["stations-tab", "stations-tab-toolbar", "button-import-stations", "button-download-stations", "button-add-station-row", "input-station-demand-LAX", "added-stations-section", "row-added-station-as-1", "input-added-station-demand-as-1", "button-delete-added-station-as-1"]) {
      expect(screen.getByTestId(id)).toBeInTheDocument();
    }
    expect(screen.getByTestId("input-station-demand-LAX")).toHaveValue("");
    expect(screen.getByTestId("input-station-demand-LAX")).toHaveAttribute("placeholder", "base demand");
    expect(screen.getByTestId("input-station-demand-SEA")).toHaveValue("1,234,567");
    expect(screen.getByTestId("input-added-station-demand-as-1")).toHaveValue("900,000");
  });

  it("integer mode: inputMode numeric, '.' rejected, \"tons\" suffix linked (user decision), no aria-label", () => {
    renderTab();
    const input = screen.getByTestId("input-added-station-demand-as-1");
    expect(input).toHaveAttribute("inputmode", "numeric");
    expect(input).not.toHaveAttribute("aria-label");
    expect(document.getElementById(input.getAttribute("aria-describedby") ?? "")).toHaveTextContent("tons");
    fireEvent.change(input, { target: { value: "900,000.5" } });
    expect(input).toHaveValue("900,000");
  });

  it("emptying a base demand clears the override; emptying an added demand saves nothing and reverts on blur", () => {
    function Parent() {
      const [o, setO] = useState<StationOverride[]>([{ id: "SEA", demand: 1234567 }]);
      const [a, setA] = useState<AddedStation[]>(added);
      return (
        <>
          <StationsTab stations={stations} overrides={o} onChange={setO} addedStations={a} onAddedStationsChange={setA} onDeleteStation={vi.fn()} />
          <output data-testid="state">{JSON.stringify({ o, a: a.map(s => s.demand) })}</output>
        </>
      );
    }
    render(<Parent />, { wrapper: AllProviders });
    fireEvent.change(screen.getByTestId("input-station-demand-SEA"), { target: { value: "" } });
    expect(JSON.parse(screen.getByTestId("state").textContent ?? "")).toEqual({ o: [], a: [900000] });
    fireEvent.change(screen.getByTestId("input-added-station-demand-as-1"), { target: { value: "" } });
    expect(JSON.parse(screen.getByTestId("state").textContent ?? "")).toEqual({ o: [], a: [900000] });
    fireEvent.blur(screen.getByTestId("input-added-station-demand-as-1"));
    expect(screen.getByTestId("input-added-station-demand-as-1")).toHaveValue("900,000");
    fireEvent.change(screen.getByTestId("input-added-station-demand-as-1"), { target: { value: "8000000" } });
    expect(JSON.parse(screen.getByTestId("state").textContent ?? "")).toEqual({ o: [], a: [8000000] });
  });

  it("history read-only (D2): base + added demand, delete and the add trigger are disabled", () => {
    renderTab({ readOnly: true });
    for (const id of ["input-station-demand-LAX", "input-added-station-demand-as-1", "button-delete-added-station-as-1", "button-add-station-row"]) {
      expect(screen.getByTestId(id)).toBeDisabled();
    }
  });

  it("+ Add station: empty demand blocks; an integer demand appends an as- station", () => {
    const onAdded = vi.fn();
    renderTab({ onAddedStationsChange: onAdded });
    fireEvent.click(screen.getByTestId("button-add-station-row"));
    const d = screen.getByTestId("create-entity-dialog");
    for (const [id, v] of [["create-entity-city", "Akron"], ["create-entity-state", "OH"], ["create-entity-lat", "41.08"], ["create-entity-lng", "-81.52"]] as const) {
      fireEvent.change(within(d).getByTestId(id), { target: { value: v } });
    }
    fireEvent.click(within(d).getByTestId("create-entity-submit"));
    expect(within(d).getByTestId("create-entity-error")).toHaveTextContent("Demand must be a number ≥ 0.");
    fireEvent.change(within(d).getByTestId("create-entity-demand"), { target: { value: "8000000" } });
    fireEvent.click(within(d).getByTestId("create-entity-submit"));
    const next = onAdded.mock.calls[0]![0] as AddedStation[];
    expect(next[1]!.id).toMatch(/^as-/);
    expect(next[1]).toMatchObject({ city: "Akron", demand: 8000000, displayCode: "ST-OH-AKRON-01" });
  });
});
SCU_EOF
```

- [ ] **Step 3: Run it to verify it fails**

Run: `pnpm --filter studio exec vitest run src/__tests__/StationsTab.dataTable.test.tsx`
Expected: FAIL — `Tests  5 failed (5)` (measured at plan time against the pre-migration tab) — the history test finds enabled controls (and `readOnly` is not yet a prop — a type error under `pnpm --filter studio typecheck`), and the menu/filter/centring assertions find today's single buttons, From/To boxes and left-aligned numbers.

- [ ] **Step 4: Implement — `StationsTab.tsx`**

Replace the whole file `artifacts/studio/src/components/workspace/tabs/StationsTab.tsx` with:

```bash
mkdir -p artifacts/studio/src/components/workspace/tabs && cat > artifacts/studio/src/components/workspace/tabs/StationsTab.tsx <<'SCU_EOF'
import { useState } from "react";
import type { Scenario } from "@workspace/api-client-react";
import type { StationOverride } from "@/components/tables/StationTable";
import { Button } from "@/components/ui/button";
import { AlertTriangle } from "lucide-react";
import { completenessCountForStation, idCollisionMessageForStation, type PrecheckErrorLike } from "@/lib/precheckDisplay";
import { CreateEntityDialog } from "@/components/workspace/map/dialogs/CreateEntityDialog";
import { DataTable } from "@/components/data-table/DataTable";
import type { ColumnDef } from "@/components/data-table/types";
import { useEntityFileMenus } from "@/components/data-table/useEntityFileMenus";
import { DeleteRowButton, DemandCell, READ_ONLY_TITLE } from "@/components/data-table/entityCells";

interface StationRow {
  id: string;
  city: string;
  state: string;
  lat: number;
  lng: number;
  zip?: string;
}

// Task 30 (B6.1 stage 4) — matches `addedStationSchema` in
// artifacts/api-server/src/validation/inputs/transportLp.ts exactly. `demand`
// is required (non-nullable), unlike AddedMine's optional capacity — a
// brand-new station can't be added with no demand at all, same rule
// addedCustomerSchema already enforces for customers.
// T11 (Input Map v2 identity model, Step A) — `id` is now a hidden T3
// stable uid (`as-<uuid>`, minted via `newUid("st")`), never typed;
// `displayCode` is the human-facing, collision-checked label, matching
// CustomersTab.tsx's own T9 migration exactly.
export interface AddedStation {
  id: string;
  city: string;
  state: string;
  lat: number;
  lng: number;
  demand: number;
  displayCode?: string;
}

interface StationsTabProps {
  stations: StationRow[];
  overrides: StationOverride[];
  onChange: (next: StationOverride[]) => void;
  /** Undefined while the scenario hasn't resolved yet — Upload/Download stay disabled until it has. */
  scenarioId?: number;
  /** Fired after a successful import apply, with the updated scenario — the caller (Workspace.tsx) refreshes its inputs draft from it. */
  onImportApplied?: (scenario: Scenario) => void;
  /** Task 30 — scenario-local addedStations. Fired on both add (append) and in-row demand edits — full replacement array, same `onChange`-out convention as every other tab. */
  addedStations?: AddedStation[];
  onAddedStationsChange?: (next: AddedStation[]) => void;
  /** Fired on delete only — kept separate from onAddedStationsChange because the caller (Workspace.tsx) also needs to purge any laneCostOverrides referencing this id in the SAME atomic inputs update, same pattern B5.2 established for warehouses/customers + distanceOverrides. */
  onDeleteStation?: (id: string) => void;
  /** B6.1 stage 3's precheck errors for the current scenario — drives the inline "N mines lack a lane cost" chip on added rows. Undefined/omitted degrades to "no warnings shown", never a crash. */
  precheckErrors?: PrecheckErrorLike[];
  /** SCU-2.P4.14 (D2) — browsing result history: base and added demand,
   * delete and the "+ Add station" trigger are disabled (no disabled prop before). */
  readOnly?: boolean;
}

/** One effective row: a base station with its demand override, or an added station. */
interface StationTableRow {
  id: string;
  displayId: string;
  city: string;
  state: string;
  lat: number;
  lng: number;
  zip?: string;
  /** Base: the override only (blank = base demand, unchanged); added: the stored demand. */
  demand: number | null;
  added: boolean;
}

// Task 30 → SCU-2.P4.14 (spec B2.1–B2.4, B2.8, B2.9, D2) — transport-coal's
// Stations tab on the shared DataTable: base and added stations under ONE
// toolbar (Upload ▾, Download ▾, "+ Add station" modal, FilterMenu above 10
// rows) and one pager. Station demand is a FormattedNumberInput in INTEGER
// mode (user decision 2026-10-17; it parsed with parseInt before): grouped,
// "tons" suffix (user decision), "." rejected. Emptying a base demand clears the override
// (blank = base demand, as before); emptying an ADDED demand saves nothing
// and reverts on blur (it committed 0 before). The legacy `StationTable` is
// no longer rendered here.
export function StationsTab({
  stations,
  overrides,
  onChange,
  scenarioId,
  onImportApplied,
  addedStations = [],
  onAddedStationsChange,
  onDeleteStation,
  precheckErrors = [],
  readOnly = false,
}: StationsTabProps) {
  const files = useEntityFileMenus({
    entity: "stations",
    testIdEntity: "stations",
    modelId: "transport-coal",
    scenarioId,
    onImportApplied,
  });
  const [adding, setAdding] = useState(false);

  function upsertBase(id: string, demand: number | null) {
    if (readOnly) return;
    const rest = overrides.filter(o => o.id !== id);
    onChange(demand == null ? rest : [...rest, { id, demand }]);
  }
  function upsertAdded(id: string, demand: number) {
    if (readOnly) return;
    onAddedStationsChange?.(addedStations.map(s => (s.id === id ? { ...s, demand } : s)));
  }

  const rows: StationTableRow[] = [
    ...stations.map(s => ({ ...s, displayId: s.id, demand: overrides.find(o => o.id === s.id)?.demand ?? null, added: false })),
    ...addedStations.map(s => ({
      id: s.id,
      displayId: s.displayCode ?? s.id,
      city: s.city,
      state: s.state,
      lat: s.lat,
      lng: s.lng,
      demand: s.demand,
      added: true,
    })),
  ];

  const location = (added: boolean): ColumnDef<StationTableRow>[] => [
    {
      id: "id",
      header: "ID",
      kind: "text",
      filter: "text",
      value: r => r.displayId,
      cellClassName: "font-mono text-xs",
      cell: r => {
        if (!added) return r.displayId;
        const missing = completenessCountForStation(precheckErrors, r.id);
        const collision = idCollisionMessageForStation(precheckErrors, r.id);
        return (
          <div className="flex items-center gap-1">
            {r.displayId}
            {(missing > 0 || collision) && (
              <span
                title={
                  collision ??
                  `${missing} mine${missing === 1 ? " lacks" : "s lack"} a lane cost to this station — see the Lane costs tab, or download/upload a template.`
                }
                data-testid={`warning-precheck-added-station-${r.id}`}
                className="inline-flex items-center gap-0.5 text-[10px] text-amber-700 bg-amber-100 border border-amber-300 rounded px-1"
              >
                <AlertTriangle className="w-3 h-3" />
                {collision ? "ID collision" : `Missing ${missing} lane cost${missing === 1 ? "" : "s"}`}
              </span>
            )}
          </div>
        );
      },
    },
    { id: "city", header: "City", kind: "text", filter: "text", value: r => r.city, cellClassName: "text-xs", cell: r => r.city },
    {
      id: "state",
      header: "State",
      kind: "text",
      filter: "text",
      value: r => r.state || null,
      cellClassName: "text-xs",
      cell: r => r.state,
    },
    {
      id: "lat",
      header: "Latitude",
      kind: "number",
      value: r => r.lat,
      cellClassName: "text-xs font-mono",
      cell: r => r.lat.toFixed(4),
    },
    {
      id: "lng",
      header: "Longitude",
      kind: "number",
      value: r => r.lng,
      cellClassName: "text-xs font-mono",
      cell: r => r.lng.toFixed(4),
    },
  ];
  const demand = (added: boolean): ColumnDef<StationTableRow> => ({
    id: "demand",
    header: added ? "Demand" : "Demand override (tons)",
    filterLabel: "Demand",
    kind: "number",
    value: r => r.demand,
    cell: r => (
      <DemandCell
        suffix="tons"
        value={r.demand}
        integer
        clearCommits={!added}
        onCommit={v => (added ? v !== null && upsertAdded(r.id, v) : upsertBase(r.id, v))}
        disabled={readOnly}
        title={readOnly ? READ_ONLY_TITLE : undefined}
        placeholder={added ? undefined : "base demand"}
        testId={added ? `input-added-station-demand-${r.id}` : `input-station-demand-${r.id}`}
      />
    ),
  });
  const hasZip = stations.some(s => s.zip);
  const baseColumns: ColumnDef<StationTableRow>[] = [
    ...location(false),
    ...(hasZip
      ? [
          {
            id: "zip",
            header: "Zip",
            kind: "text",
            filter: "text",
            value: r => r.zip ?? null,
            cellClassName: "text-xs font-mono",
            cell: r => r.zip ?? "—",
          } satisfies ColumnDef<StationTableRow>,
        ]
      : []),
    demand(false),
  ];
  const addedColumns: ColumnDef<StationTableRow>[] = [
    ...location(true),
    demand(true),
    {
      id: "delete",
      header: "",
      kind: "text",
      filter: false,
      value: () => null,
      cell: r => (
        <DeleteRowButton
          label={`Delete added station ${r.id}`}
          onClick={() => onDeleteStation?.(r.id)}
          disabled={readOnly}
          testId={`button-delete-added-station-${r.id}`}
        />
      ),
    },
  ];

  const addTrigger = onAddedStationsChange != null && (
    <Button
      size="sm"
      variant="outline"
      className="h-7 px-2 text-xs"
      onClick={() => setAdding(true)}
      disabled={readOnly}
      title={readOnly ? READ_ONLY_TITLE : undefined}
      data-testid="button-add-station-row"
    >
      + Add station
    </Button>
  );

  return (
    <div data-testid="stations-tab">
      <DataTable<StationTableRow>
        rows={rows}
        rowKey={r => `${r.added ? "added" : "base"}:${r.id}`}
        columns={baseColumns}
        ctx={{ readOnly, demandEditable: true, isAdded: r => r.added }}
        testIds={{
          toolbar: "stations-tab-toolbar",
          pagerPrev: "button-stations-prev",
          pagerNext: "button-stations-next",
          pageIndicator: "stations-page-indicator",
        }}
        toolbar={{ upload: files.upload, download: files.download, add: addTrigger }}
        sections={[
          {
            id: "base",
            includes: r => !r.added,
            scrollClassName: "max-h-[60vh] overflow-y-auto",
            emptyState: (
              <p className="text-sm text-muted-foreground" data-testid="stations-tab-empty">
                No stations in this dataset.
              </p>
            ),
          },
          ...(onAddedStationsChange != null
            ? [
                {
                  id: "added",
                  title: "Added stations",
                  testId: "added-stations-section",
                  includes: (r: StationTableRow) => r.added,
                  columns: addedColumns,
                  rowTestId: (r: StationTableRow) => `row-added-station-${r.id}`,
                  scrollClassName: "max-h-[40vh] overflow-y-auto",
                  emptyState: (
                    <p className="text-xs text-muted-foreground" data-testid="added-stations-empty">
                      No added stations yet — use "+ Add station" above to create one.
                    </p>
                  ),
                },
              ]
            : []),
        ]}
      />
      {adding && (
        <CreateEntityDialog
          source="table"
          entityKind="station"
          existingCodes={addedStations.map(s => s.displayCode).filter((c): c is string => !!c)}
          onCreate={r => {
            if (r.kind === "station") onAddedStationsChange?.([...addedStations, r.entity]);
            setAdding(false);
          }}
          onCancel={() => setAdding(false)}
        />
      )}
      {files.dialog}
    </div>
  );
}
SCU_EOF
```

- [ ] **Step 5: Wire Workspace, flip the D2 guard, rewrite the by-design test breaks**

Adds `readOnly={isBrowsingHistoryNow}` to the `<StationsTab` mount, flips the last pending guard entry and adds the "no input tab is left pending" assertion, rewrites `StationsTab.test.tsx` (menus, modal), `Workspace.test.tsx` (modal ids) and `Workspace.TransportCoal.test.tsx` (Download ▾ trigger):

```bash
python3 - <<'PY'
import pathlib
EDITS = [
    ('artifacts/studio/src/__tests__/StationsTab.test.tsx',
     '''import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StationsTab } from "@/components/workspace/tabs/StationsTab";

const stations = [''',
     '''import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StationsTab } from "@/components/workspace/tabs/StationsTab";
import { chooseInputDownload, chooseUpload } from "@/__tests__/helpers/inputTable";

const stations = ['''),
    ('artifacts/studio/src/__tests__/StationsTab.test.tsx',
     '''      </ExportProviderTestWrapper>,
    );
    expect(screen.getByTestId("button-export-stations-csv")).toBeDisabled();
    expect(screen.getByTestId("button-export-stations-json")).toBeDisabled();
    expect(screen.getByTestId("button-import-stations")).toBeDisabled();
  });''',
     '''      </ExportProviderTestWrapper>,
    );
    // SCU-2.P4 (B2.3/B2.4) — one Download ▾ trigger now carries the disabled state.
    expect(screen.getByTestId("button-download-stations")).toBeDisabled();
    expect(screen.getByTestId("button-import-stations")).toBeDisabled();
  });'''),
    ('artifacts/studio/src/__tests__/StationsTab.test.tsx',
     '''    );

    await userEvent.click(screen.getByTestId("button-export-stations-csv"));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());''',
     '''    );

    chooseInputDownload("stations", "csv");

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());'''),
    ('artifacts/studio/src/__tests__/StationsTab.test.tsx',
     '''    renderWithQueryClient(<StationsTab stations={stations} overrides={[]} onChange={vi.fn()} scenarioId={7} />);
    expect(screen.queryByText("Import stations")).not.toBeInTheDocument();
    await userEvent.click(screen.getByTestId("button-import-stations"));
    expect(screen.getByText("Import stations")).toBeInTheDocument();
    expect(screen.getByTestId("input-import-file-stations")).toBeInTheDocument();''',
     '''    renderWithQueryClient(<StationsTab stations={stations} overrides={[]} onChange={vi.fn()} scenarioId={7} />);
    expect(screen.queryByText("Import stations")).not.toBeInTheDocument();
    chooseUpload("stations", "csv");
    expect(screen.getByText("Import stations")).toBeInTheDocument();
    expect(screen.getByTestId("input-import-file-stations")).toBeInTheDocument();'''),
    ('artifacts/studio/src/__tests__/StationsTab.test.tsx',
     '    );\n\n    await userEvent.click(screen.getByTestId("button-import-stations"));\n    const file = new File(["id,demand\\nS1,2000"], "stations.csv", { type: "text/csv" });\n    await userEvent.upload(screen.getByTestId("input-import-file-stations"), file);',
     '    );\n\n    chooseUpload("stations", "csv");\n    const file = new File(["id,demand\\nS1,2000"], "stations.csv", { type: "text/csv" });\n    await userEvent.upload(screen.getByTestId("input-import-file-stations"), file);'),
    ('artifacts/studio/src/__tests__/StationsTab.test.tsx',
     '''
    await userEvent.click(screen.getByTestId("button-add-station-row"));
    await userEvent.type(screen.getByTestId("input-new-station-city"), "Denver");
    await userEvent.type(screen.getByTestId("input-new-station-state"), "CO");
    await userEvent.type(screen.getByTestId("input-new-station-lat"), "39.74");
    await userEvent.type(screen.getByTestId("input-new-station-lng"), "-104.99");
    await userEvent.type(screen.getByTestId("input-new-station-demand"), "900000");
    await userEvent.click(screen.getByTestId("button-add-station-confirm"));

    expect(onAddedStationsChange).toHaveBeenCalledTimes(1);''',
     '''
    await userEvent.click(screen.getByTestId("button-add-station-row"));
    await userEvent.type(screen.getByTestId("create-entity-city"), "Denver");
    await userEvent.type(screen.getByTestId("create-entity-state"), "CO");
    await userEvent.type(screen.getByTestId("create-entity-lat"), "39.74");
    await userEvent.type(screen.getByTestId("create-entity-lng"), "-104.99");
    await userEvent.type(screen.getByTestId("create-entity-demand"), "900000");
    await userEvent.click(screen.getByTestId("create-entity-submit"));

    expect(onAddedStationsChange).toHaveBeenCalledTimes(1);'''),
    ('artifacts/studio/src/__tests__/StationsTab.test.tsx',
     '''
    await userEvent.click(screen.getByTestId("button-add-station-row"));
    await userEvent.type(screen.getByTestId("input-new-station-city"), "Denver");
    await userEvent.type(screen.getByTestId("input-new-station-state"), "CO");
    await userEvent.type(screen.getByTestId("input-new-station-lat"), "39.74");
    await userEvent.type(screen.getByTestId("input-new-station-lng"), "-104.99");
    // Demand left blank on purpose.
    await userEvent.click(screen.getByTestId("button-add-station-confirm"));

    expect(onAddedStationsChange).not.toHaveBeenCalled();
    expect(screen.getByTestId("text-add-station-error")).toBeInTheDocument();
  });
''',
     '''
    await userEvent.click(screen.getByTestId("button-add-station-row"));
    await userEvent.type(screen.getByTestId("create-entity-city"), "Denver");
    await userEvent.type(screen.getByTestId("create-entity-state"), "CO");
    await userEvent.type(screen.getByTestId("create-entity-lat"), "39.74");
    await userEvent.type(screen.getByTestId("create-entity-lng"), "-104.99");
    // Demand left blank on purpose.
    await userEvent.click(screen.getByTestId("create-entity-submit"));

    expect(onAddedStationsChange).not.toHaveBeenCalled();
    expect(screen.getByTestId("create-entity-error")).toBeInTheDocument();
  });
'''),
    ('artifacts/studio/src/__tests__/StationsTab.test.tsx',
     '''
    await userEvent.click(screen.getByTestId("button-add-station-row"));
    await userEvent.type(screen.getByTestId("input-new-station-city"), "Chicago");
    await userEvent.type(screen.getByTestId("input-new-station-state"), "IL");
    fireEvent.blur(screen.getByTestId("input-new-station-state"));
    await userEvent.clear(screen.getByTestId("input-new-station-display-code"));
    await userEvent.type(screen.getByTestId("input-new-station-display-code"), "DUPE");
    await userEvent.type(screen.getByTestId("input-new-station-demand"), "500");
    await userEvent.click(screen.getByTestId("button-add-station-confirm"));

    expect(onAddedStationsChange).not.toHaveBeenCalled();
    expect(screen.getByTestId("text-add-station-error")).toBeInTheDocument();
  });
''',
     '''
    await userEvent.click(screen.getByTestId("button-add-station-row"));
    await userEvent.type(screen.getByTestId("create-entity-city"), "Chicago");
    await userEvent.type(screen.getByTestId("create-entity-state"), "IL");
    fireEvent.blur(screen.getByTestId("create-entity-state"));
    await userEvent.clear(screen.getByTestId("create-entity-display-code"));
    await userEvent.type(screen.getByTestId("create-entity-display-code"), "DUPE");
    await userEvent.type(screen.getByTestId("create-entity-demand"), "500");
    await userEvent.click(screen.getByTestId("create-entity-submit"));

    expect(onAddedStationsChange).not.toHaveBeenCalled();
    expect(screen.getByTestId("create-entity-error")).toBeInTheDocument();
  });
'''),
    ('artifacts/studio/src/__tests__/StationsTab.test.tsx',
     '''    expect(screen.getByTestId("stations-tab")).toBeInTheDocument();
    expect(screen.getByTestId("stations-tab-toolbar")).toBeInTheDocument();
    expect(screen.getByTestId("button-export-stations-csv")).toBeInTheDocument();
    expect(screen.getByTestId("button-import-stations")).toBeInTheDocument();
    expect(screen.getByText("S1")).toBeInTheDocument();''',
     '''    expect(screen.getByTestId("stations-tab")).toBeInTheDocument();
    expect(screen.getByTestId("stations-tab-toolbar")).toBeInTheDocument();
    expect(screen.getByTestId("button-download-stations")).toBeInTheDocument();
    expect(screen.getByTestId("button-import-stations")).toBeInTheDocument();
    expect(screen.getByText("S1")).toBeInTheDocument();'''),
    ('artifacts/studio/src/__tests__/StationsTab.test.tsx',
     '''      />,
    );
    expect(screen.queryByTestId("add-station-row-form")).not.toBeInTheDocument();
    await userEvent.click(screen.getByTestId("button-add-station-row"));
    expect(screen.getByTestId("add-station-row-form")).toBeInTheDocument();
    expect(screen.getByTestId("stations-tab")).toBeInTheDocument();
    expect(screen.getByText("S1")).toBeInTheDocument();''',
     '''      />,
    );
    expect(screen.queryByTestId("create-entity-dialog")).not.toBeInTheDocument();
    await userEvent.click(screen.getByTestId("button-add-station-row"));
    expect(screen.getByTestId("create-entity-dialog")).toBeInTheDocument();
    expect(screen.getByTestId("stations-tab")).toBeInTheDocument();
    expect(screen.getByText("S1")).toBeInTheDocument();'''),
    ('artifacts/studio/src/__tests__/Workspace.test.tsx',
     '''    // T11 (Step A, grid-mirror) — mirrors the mine test's own comment above.
    fireEvent.change(screen.getByTestId("input-new-station-city"), { target: { value: "Newtown" } });
    fireEvent.change(screen.getByTestId("input-new-station-state"), { target: { value: "NC" } });
    fireEvent.change(screen.getByTestId("input-new-station-lat"), { target: { value: "35.5" } });
    fireEvent.change(screen.getByTestId("input-new-station-lng"), { target: { value: "-80.2" } });
    fireEvent.change(screen.getByTestId("input-new-station-demand"), { target: { value: "900000" } });
    fireEvent.click(screen.getByTestId("button-add-station-confirm"));
''',
     '''    // T11 (Step A, grid-mirror) — mirrors the mine test's own comment above.
    fireEvent.change(screen.getByTestId("create-entity-city"), { target: { value: "Newtown" } });
    fireEvent.change(screen.getByTestId("create-entity-state"), { target: { value: "NC" } });
    fireEvent.change(screen.getByTestId("create-entity-lat"), { target: { value: "35.5" } });
    fireEvent.change(screen.getByTestId("create-entity-lng"), { target: { value: "-80.2" } });
    fireEvent.change(screen.getByTestId("create-entity-demand"), { target: { value: "900000" } });
    fireEvent.click(screen.getByTestId("create-entity-submit"));
'''),
    ('artifacts/studio/src/__tests__/Workspace.TransportCoal.test.tsx',
     '''    fireEvent.click(screen.getByTestId("sidebar-input-stations"));
    expect(screen.getByTestId("button-export-stations-csv")).toBeInTheDocument();
    expect(screen.getByTestId("button-import-stations")).toBeInTheDocument();''',
     '''    fireEvent.click(screen.getByTestId("sidebar-input-stations"));
    expect(screen.getByTestId("button-download-stations")).toBeInTheDocument();
    expect(screen.getByTestId("button-import-stations")).toBeInTheDocument();'''),
    ('artifacts/studio/src/pages/Workspace.tsx',
     '''        <StationsTab
''',
     '''        <StationsTab
          readOnly={isBrowsingHistoryNow}
'''),
    ('artifacts/studio/src/__tests__/historyReadOnlyTabs.test.ts',
     '''  StationsTab: "pending", // SCU-2.P4.14''',
     '''  StationsTab: "readOnly", // SCU-2.P4.14'''),
    ('artifacts/studio/src/__tests__/historyReadOnlyTabs.test.ts',
     '''  it("the mount scanner is not vacuous: it finds both WarehousesTab mounts", () => {''',
     '''  it("no input tab is left pending (every P4 migration wired its flag)", () => {
    expect(Object.entries(INPUT_TAB_HISTORY_PROP).filter(([, prop]) => prop === "pending")).toEqual([]);
  });

  it("the mount scanner is not vacuous: it finds both WarehousesTab mounts", () => {'''),
]
for path, old, new in EDITS:
    f = pathlib.Path(path)
    s = f.read_text()
    n = s.count(old)
    if n != 1:
        raise SystemExit(f'STOP: {path}: anchor found {n} times (expected 1): {old[:80]!r}')
    f.write_text(s.replace(old, new, 1))
print(f'applied {len(EDITS)} edits')
PY
```

- [ ] **Step 6: Run the task's tests**

Run: `pnpm --filter studio exec vitest run src/__tests__/StationsTab.dataTable.test.tsx src/__tests__/StationsTab.test.tsx src/__tests__/Workspace.TransportCoal.test.tsx src/__tests__/Workspace.test.tsx src/__tests__/historyReadOnlyTabs.test.ts`
Expected: PASS — 207 tests in 5 files (measured at plan time). Then `pnpm --filter studio typecheck` → exit 0.

- [ ] **Step 7: e2e sweep, rewrites and local run**

Sweep (matrix §3 prefixes for this instance; `labs.spec.ts` excluded):
```bash
grep -rn -E 'stations-tab|added-stations-|row-added-station-|button-add-station-|input-new-station-|input-station-demand-|input-added-station-demand-|button-export-stations|button-import-stations' artifacts/studio/e2e --include='*.ts' | grep -v labs.spec.ts
```
No rewrite needed: only `stations-tab` and `button-add-station-row` visibility are referenced.

Then `pnpm --filter studio typecheck:e2e` (exit 0) and, with both local servers up (Global Constraints), run
```bash
cd artifacts/studio && E2E_BASE_URL=http://localhost:5179 npx playwright test e2e/workspace-fixups-2.spec.ts e2e/bundle2-fastfollow.spec.ts e2e/tab-coverage.spec.ts
```
Expected: every test passes (a failure → flake registry by test name, two isolated re-runs, before calling it a regression). Record per-spec pass/fail in the changelog entry.

- [ ] **Step 8: Gate**

Run each separately (Global Constraints):
1. `cnt=$(ps aux | grep "[v]itest" | grep -v "zsh -c" | wc -l | tr -d ' '); [ "$cnt" = "0" ]`
2. `pnpm run typecheck`
3. `pnpm --filter studio typecheck:e2e`
4. `DATABASE_URL="postgresql://shubhamkr@localhost:5432/nos_dev" pnpm --filter api-server test`
5. `pnpm --filter studio test`
6. `(cd artifacts/api-server/src/solver && python3 -m pytest tests/ -x)`
7. `pnpm --filter @workspace/import-schema test`

Expected: every command exits 0. Then `git diff --stat "$P3_TIP"..HEAD -- artifacts/api-server lib/db lib/api-spec` prints nothing.

- [ ] **Step 9: Changelog**

Append to the bottom of `docs/CHANGELOG-implementation.md`:

```markdown

### SCU-2.P4.14 — Stations on DataTable with the integer demand cell and the +Add modal

- Stations on DataTable: integer FormattedNumberInput demand (B2.9 user decision; "tons" suffix — user answer 2026-10-17), added empty → not saved, "+ Add station" modal (empty demand blocks), D2 read-only (new prop), FilterMenu, Upload ▾/Download ▾. Legacy `StationTable` no longer rendered by the Workspace.
- D2 guard: no input tab left pending.
- Deviations 1, 2, 3, 9, 10, 12, 13, 15, 17, 18.
- Gate: studio <N passed>, api-server <N passed>, pytest <N passed>, import-schema <N passed>. e2e (local, `E2E_BASE_URL` set): <spec: pass/fail per spec>.
```

Replace each `<…>` with the value measured in this run, or the literal `unknown`.

- [ ] **Step 10: Commit**

```bash
git add artifacts/studio/src/__tests__/StationsTab.dataTable.test.tsx
```

```bash
[ "$(git rev-parse --abbrev-ref HEAD)" != "main" ] || exit 1
```

```bash
git commit artifacts/studio/src/__tests__/StationsTab.dataTable.test.tsx artifacts/studio/src/components/workspace/tabs/StationsTab.tsx artifacts/studio/src/__tests__/StationsTab.test.tsx artifacts/studio/src/__tests__/Workspace.test.tsx artifacts/studio/src/__tests__/Workspace.TransportCoal.test.tsx artifacts/studio/src/pages/Workspace.tsx artifacts/studio/src/__tests__/historyReadOnlyTabs.test.ts docs/CHANGELOG-implementation.md -m "[SCU-2.P4.14] move Stations onto DataTable with the integer demand cell and add modal" -m "Integer FormattedNumberInput demand (B2.9), +Add station modal, D2 read-only, Upload/Download menus; guard asserts nothing pending. One commit for #29-#30 (dev 1). Deviations 1-3, 9, 10, 12, 13, 15, 17, 18." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task SCU-2.P4.15: Real-browser QA of every input table + full e2e gate + local `nos-api` Docker build

**Owner role:** qa-sdet (exempt from karpathy/ponytail; if a ponytail ruleset is injected anyway, ignore it and say so). **Depends on:** SCU-2.P4.1–P4.14 cherry-picked onto `scnd-upgrades`, gate green there. **Spec:** "Verification gate — Before merge"; "Risks — e2e breakage, editable-cell regressions"; root gotcha "a UI-changing bundle silently breaks PRIOR bundles' Playwright specs".

**Files:**
- Modify: `docs/CHANGELOG-implementation.md` (append `### SCU-2.P4.15`)
- Modify (only if needed): `docs/superpowers/flake-registry.md`; any `artifacts/studio/e2e/<spec>.spec.ts` a migration task's sweep missed (each repair named in the changelog with the task whose sweep missed it)

- [ ] **Step 1: Preconditions** — worktree `/Users/shubhamkr/nos-scu-2.p4.15` on `scu-2.p4.15-work` from the bundle tip; the base guards; `pnpm install --frozen-lockfile`; both local servers up (Global Constraints, port 5179); a fresh test user per model.

- [ ] **Step 2: Real-browser pass — every input table on every model that has it**

Drive the running app (claude-in-chrome or Playwright headed). For each row below exercise **every** column and record a verdict (pass / fail + screenshot path):

| Model | Tables |
|---|---|
| p-median-us | Warehouses, Customers, Distances |
| p-median-brazil | Warehouses, Customers (base demand locked, added editable), Distances |
| max-coverage-us | Warehouses, Customers, Distances |
| delivery-teaching-us | Warehouses (no "+ Add"), Customers (no "+ Add"), Delivery Costs |
| transport-coal | Mines, Stations, Lane Costs |
| two-echelon-gold-au | Refineries ("+ Add refinery" on `button-add-warehouse-row`), Customers, Leg Distances |
| two-echelon-jade-us | Warehouses, Customers (per-product), Plants, Plant Capability Matrix (no Upload/Download), Transport Costs (no Upload/Download), JADE Distances |

Per table check: (a) **Upload ▾** CSV **and** JSON — upload the file **Download ▾** just produced for the same entity (no-change preview), then a one-row edited CSV and JSON (exactly one change, applied, visible in the table); a > 2 MB file is refused before upload with the limit sentence (P2); (b) **Download ▾** CSV and JSON save files whose header / envelope match the expected-fields panel (`<details>` "Expected fields": column list, required text, enums, bounds, unit, examples); (c) **filter**: the trigger appears exactly when rows > 10, From/To (distance tables) are text controls inside it, a filter covering base + added rows narrows both sections, "(empty)" shows for null values, no From/To boxes anywhere; (d) **paging**: pager only above 50 filtered rows, Prev/Next, filter change → page 1, deleting a row → page 1; (e) **"+ Add {Entity}"** for the six entities: lat/lng editable and gazetteer-filled on City/State blur, every inline validation message reachable, empty demand blocks (scalar, JADE per-product, station), the new row appears in the added section and survives Save + reload; from the **Input Map** the same dialog still shows lat/lng read-only; (f) **demand**: typing `1234567.5` shows `1,234,567.5` live with the caret staying put, a "Units" suffix on customer demand and "tons" on station demand, station demand rejects "."; emptying a base demand reverts to the base value on blur; emptying an added demand reverts to its last value on blur and is not saved (check `GET /api/scenarios/:id`); (g) **history**: solve twice, step back with the result stepper — every editable control in every table (base, added, JADE per-product, Plants/Mines/Stations, every distance/cost tab, Capability Matrix checkboxes, Transport Costs) is disabled with the "Read-only while browsing result history." title, and "+ Add" / "+ Add row" / delete are disabled; Download ▾ **and Upload ▾** are disabled with "Input exports reflect the current scenario"; (h) **layout**: numeric headers and cells centred, nothing overflows the panel at 1280 px and 390 px widths, each toolbar stays one line at 1280 px (`workspace-fixups-2.spec.ts` asserts < 40 px for Warehouses), focus jump from a precheck/estimate toast scrolls the row into view (Distances, JADE Distances, Leg Distances, Lane Costs).

- [ ] **Step 3: Full e2e gate (local)**

Before it, sweep the whole e2e tree for any selector a P4 task removed and no task rewrote (root gotcha): `grep -rn -E 'input-new-(warehouse|customer|plant|mine|station)|button-add-(warehouse|customer|plant|mine|station)-(confirm|cancel)|add-(warehouse|customer|plant|mine|station)-row-form|text-add-(warehouse|customer|plant|mine|station)-error|error-customer-demand-' artifacts/studio/e2e | grep -v labs.spec.ts` → no hit; and every remaining `button-export-<input entity>-(csv|json)` / `button-import-<input entity>` hit must open its menu first (read each). Then:
```bash
cd artifacts/studio && E2E_BASE_URL=http://localhost:5179 pnpm e2e:gate
```
Expected: 0 failures. Every failure: flake registry by test name → two isolated re-runs → either a registry entry or a repair (named with the task whose sweep missed it). Also `E2E_BASE_URL=http://localhost:5179 pnpm e2e:quarantine` and record its result (quarantine is not a pass condition).

- [ ] **Step 4: Solver scripts and server untouched** — `git diff --name-only "$P3_TIP"..HEAD -- artifacts/api-server lib` → empty; `(cd artifacts/api-server/src/solver && python3 e2e_accuracy.py)` → all pass (99/99 at the JADE section); `python3 e2e_journey.py http://localhost:3001 delivery` and `… transport` → pass.

- [ ] **Step 5: Local `nos-api` Docker build** — from the worktree root: `docker build -t nos-api-scu-2-p4 .` → exit 0 (record duration). The studio build: `pnpm --filter studio... build` → exit 0.

- [ ] **Step 6: Gate** — the seven Global Constraints commands, each separately, all exit 0.

- [ ] **Step 7: Changelog + commit** — append `### SCU-2.P4.15 — QA: input tables in a real browser + full e2e gate` with the per-model × per-table × (a)–(h) verdict table, the `e2e:gate` pass/fail/flaky counts, the quarantine result, the solver-script results, the Docker build result, every repaired spec (and which task's sweep missed it) and every flake-registry entry added.
```bash
[ "$(git rev-parse --abbrev-ref HEAD)" != "main" ] || exit 1
```
```bash
git commit docs/CHANGELOG-implementation.md -m "[SCU-2.P4.15] record Bundle 2 input-table browser QA and full e2e gate" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
Add each repaired `artifacts/studio/e2e/<spec>.spec.ts` and `docs/superpowers/flake-registry.md` to that pathspec when this run touched them.

---

## Task SCU-2.P4.16: Close-out (lead)

**Owner role:** lead (controller). Writes no product code. **Depends on:** SCU-2.P4.15 green.

**Files:** `docs/CHANGELOG-implementation.md` (Bundle 2 summary); `docs/superpowers/metrics/*.csv` (written by `/harness-retro`).

- [ ] **Step 1: Bundle 2 summary** — append `### SCU-B2 — bundle summary` under `## SCU-B2`: the SHA of every `[SCU-2.P1.N]`, `[SCU-2.P2.N]`, `[SCU-2.P3.N]`, `[SCU-2.P4.N]` commit (`git log --oneline <bundle-2 base>..scnd-upgrades`); the user-visible changes of P4 (FilterMenu replaces From/To on every table > 10 rows on every model; pagers only above 50 rows, incl. Delivery Costs' formerly always-on pager; Upload ▾/Download ▾ CSV+JSON with an expected-fields panel on every input table except the Capability Matrix and Transport Costs; Delivery Costs import/export; the "+ Add {Entity}" modal; grouped demand with Units and the empty-demand rules; history read-only on every input control, D2; numbers centred); P4 deviations 1–18 one line each; the three user answers folded in (below). Commit on the bundle branch:
```bash
[ "$(git rev-parse --abbrev-ref HEAD)" != "main" ] || exit 1
```
```bash
git commit docs/CHANGELOG-implementation.md -m "[SCU-B2] summarise Bundle 2 in the implementation changelog" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 2: `/harness-retro SCU-B2`** — invoke the `harness-retro` skill with task id `SCU-B2` (`.claude/skills/harness-retro/SKILL.md`). It records the metrics row, the permission audit and every gate failure by cause, and fires the second-occurrence gate rule; if it drafts `docs/superpowers/gates/<cause>.md`, STOP and put the draft to the user. Never invent a metric (`unknown`).

- [ ] **Step 3: `superpowers:finishing-a-development-branch`** — invoke it at this point (implementation complete, gates green). Put its output to the user as a recommendation, never as a licence.

- [ ] **Step 4: STOP — ask the user for merge approval.** Every task of the spec (Bundle 1 + Bundle 2 P1–P4) is now complete, so the pipeline may start — but only on an explicit yes: (1) merge `scnd-upgrades` into local `main` (first `git fetch` and `git merge-base --is-ancestor <deployed-sha> main`, so local `main` is not stale; resolve doc conflicts per the "one canonical copy" rule); (2) whole-branch review on the merged state — findings are fixed back on `scnd-upgrades` (Step 5a), re-merged; (3) push to `origin/main` only on a separate yes, said to be deploy-adjacent (a push can ship `nos-studio`; check `list_deploys` after); (4) deploy only on a third, separate yes, with the checklist from `pnpm deploy:preflight -- <deployed-sha>..HEAD`. Deploy order `nos-api` first (P2's JSON import and `deliveryCosts` need the new API). Bundle 2 has no `lib/db/src/schema/**` change (P2 asserts it), so `docs/ops/schema-push-before-deploy.md` does not apply — re-check with `git diff --stat <deployed-sha>..HEAD -- lib/db/src/schema/` before asking.

---

## Phase P4 exit (controller)

- [ ] `git log --oneline "$P3_TIP"..scnd-upgrades` shows exactly fifteen `[SCU-2.P4.N]` commits (N = 1…15) plus P4.16's `[SCU-B2]` summary.
- [ ] `git diff --stat "$P3_TIP"..scnd-upgrades -- artifacts/api-server lib/db lib/api-spec lib/api-zod lib/api-client-react` → empty.
- [ ] `grep -rn 'input-filter-from\|input-filter-to' artifacts/studio/src/components --include='*.tsx'` → no hit (the boxes are gone; the ids now come from `FilterMenu`'s `input-filter-${key}`).
- [ ] `grep -rn '<\(WarehouseTable\|CustomerTable\|MineTable\|StationTable\)\b' artifacts/studio/src --include='*.tsx' | grep -v __tests__` → only `pages/Studio.tsx` (the Workspace tabs import only their override types).
- [ ] `historyReadOnlyTabs.test.ts` has no `"pending"` entry.

## User answers folded in (2026-10-17)

1. Upload ▾ is disabled while browsing history, with the Download reason (deviation 8; RTL P4.1, e2e P4.3).
2. Station demand suffix is "tons"; customers keep "Units"; the suffix is a per-adapter prop value (deviation 12).
3. The +Add modal always generates the display code with `nextDisplayCode`, known or unknown city; the student can overwrite it (deviation 9).

## Self-review (writing-plans checklist, run against the spec, the matrix and the P1/P2/P3 plans)

**Spec coverage:**

| Spec / decision | Where |
|---|---|
| B2.1 every P4 instance on DataTable (matrix #10–#30), required `ctx`, literal testids, number centring, `w-full` inputs | P4.3–P4.14 (each `*.dataTable.test.tsx` "emits every testid in the matrix map" + centring test) |
| B2.1 `readOnly` on every editable cell in base, added, JADE rows (D2) | P4.3–P4.14 history tests; D2 wiring guard (P4.1, flips per task, "nothing pending" P4.14); browser check P4.15 (g) |
| B2.2 FilterMenu > 10 rows all models, replaces From/To, one menu for base + added (incl. JADE Plants), `(empty)` token | P4.3–P4.7 (From/To), P4.10–P4.14 (sections), P4.12 (one Plants menu), P4.15 (c) |
| B2.2 pager only > 50 filtered rows; reset on filter/row-set change | P4.3/P4.5/P4.7 tests; deviation 4; P4.15 (d) |
| B2.2 focus jump: clear filters, page against the unfiltered list, scroll — jsdom + real browser (P1 hand-off) | P4.3, P4.5 (RTL + Playwright `toBeInViewport`) |
| B2.3 Upload ▾ CSV/JSON → ImportDialog `format`, accept/2 MB guard (P2), expected-fields panel; tables incl. Delivery Costs, excl. Capability Matrix + Transport Costs | P4.1 (`useEntityFileMenus`, panel), wired P4.3–P4.7, P4.10–P4.14; P4.8/P4.9 have none |
| B2.4 Download ▾ CSV/JSON via `useExport().download`, same panel | P4.1; P4.15 (b) |
| B2.7 Delivery Costs keeps inline "+ Add row", tests 156-259 unchanged | P4.7 |
| B2.8 modal: six kinds, discriminated submit, editable lat/lng from a table / read-only from the map, per-kind fields, inline messages, trigger ids incl. D4, `create-entity-*` | P4.2 (component + tests), P4.10–P4.14 (wiring), P4.15 (e) |
| User answers 2026-10-17: Upload disabled in history; stations "tons"; modal always generates the display code | P4.1 + P4.3 (Upload); P4.11/P4.14/P4.2 (suffix prop); P4.2 (display code) |
| B2.9 FormattedNumberInput demand: grouping, caret, paste, IME, max-safe, integer (P1 component tests) | P1.6 (component); applied P4.11 (customers, JADE), P4.14 (stations) |
| B2.9 table tests: Brazil base locked vs added editable; history disabled base/added/JADE; no aria-label + describedby; empty demand blocks add submit | P4.11 (`CustomersTab.dataTable.test.tsx`), P4.14, P4.2 |
| User decisions: added demand emptied → not saved, reverts on blur; JADE blank no longer 0; station integer; no aria-label | P4.11, P4.14, P4.2 |
| B2.10 one table instance per commit; matrix refs refreshed; e2e sweep per commit | deviation 1; P4.1 Step 2; every task's e2e step |
| e2e by-design breaks: "Page 1 of 1", workspace-fixups-2 no-filter, `Number(value)` demand reads | P4.3, P4.10, P4.11 |
| Verification: gate every task; full e2e:gate + browser QA + Docker before merge | every task; P4.15 |
| Close-out: changelog, `/harness-retro SCU-B2`, finishing skill, STOP; merge/push/deploy separate; `deploy:preflight` | P4.16 |

**Placeholder scan:** the only angle-bracket tokens are measured-at-run-time values (`<N passed>`, `<B1_TIP short>`, `<P3_TIP short>`, per-spec pass/fail, `<deployed-sha>`), each with its derivation and `unknown` as the fallback. No "TBD", "similar to Task N" or "add tests here": every test file, tab file and edit is spelled out.

**Type consistency with P1/P2/P3:** every adapter passes the required `ctx` (`readOnly`, `demandEditable`) and uses only the P1 interface names (`ColumnDef` fields `id/header/filterLabel/kind/cell/value/filter/cellTestId/headerTestId/cellClassName/hidden`, `testIds.{toolbar,row,pagerPrev,pagerNext,pageIndicator,empty,count}`, `sections[].{id,title,testId,scrollTestId,scrollClassName,rowTestId,includes,columns,emptyState}`, `focus.{token,matches}`, `noMatchText`, `scrollClassName`, `toolbar.{upload,download,add,extra}`); `usePagedRows`/`TablePager` are used only through `DataTable` (page size fixed); `FormattedNumberInput` is used with `value`/`onChange(number | null)`/`suffix`/`integer` and no aria-label; P2's `ImportDialog` `format` prop, `ImportEntity` (incl. `deliveryCosts`), `IMPORT_SCHEMAS`, `exampleCsv`, `exampleJsonDocument`, `ImportFieldDescriptor` fields (`csvHeader`, `jsonKey`, `type`, `requiredForAdd`, `requiredForUpdate`, `enum`, `min`, `exclusiveMin`, `unitFamily`, `envelopeKey`, `models`) and `addModels` exactly as P2 defines them; P3's `DownloadMenu` props unchanged and extended only additively. All compiled together (`tsc` exit 0 after every task) in the plan-time scratch build.
