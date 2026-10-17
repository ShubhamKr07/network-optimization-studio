# SCND Upgrades — Bundle 2 Phase P1 Implementation Plan (DataTable shell)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. At execution start, seed a TaskCreate entry per task **and** per process gate (each task's gate run, each task's changelog entry, the phase-exit checks), per the standing ledger rule.

**Goal:** Build the Bundle 2 shared table shell — `DataTable`, its column/testid/section/focus contract, filter auto-derivation, `usePagedRows` + `TablePager`, and `FormattedNumberInput` — with its own tests and **no consumers**, plus the B2.10 migration matrix that P3/P4 migrate against.

**Architecture:** A new folder `artifacts/studio/src/components/data-table/` holds five focused files. `types.ts` is the public contract every P3/P4 adapter is written against. `deriveFilterDescriptors.ts` turns columns into `useTableFilters` descriptors. `usePagedRows.ts` + `TablePager.tsx` replace the four local `PAGE_SIZE = 50` pagers. `DataTable.tsx` composes them over the existing `components/ui/table.tsx` primitives and the existing `FilterMenu` + `useTableFilters` (reused, not rewritten: `useTableFilters.ts` gains two constants for the empty-option token, and `FilterMenu` gains an optional `triggerTestId` prop and shows that token as "(empty)"). `FormattedNumberInput.tsx` is the B2.9 demand input. No Workspace tab changes in P1; a test-only adapter proves the API reproduces `DistancesTab`'s real testid map.

**Tech Stack:** React 18 + TypeScript + Vite (`artifacts/studio`), Tailwind classes, Radix popover (inside `FilterMenu`), vitest 3 + React Testing Library 16 + `@testing-library/user-event` 14, jsdom.

**Spec (source of truth):** `docs/superpowers/specs/2026-10-16-scnd-upgrades-design.md` rev 2 — §B2.1, §B2.2, §B2.9, §B2.10 and decisions D1–D6. **Matrix (P1 artefact, consumed by P3/P4):** `docs/superpowers/plans/2026-10-17-scnd-upgrades-bundle2-matrix.md`. P2 (import-schema, JSON import, `deliveryCosts`), P3 (outputs) and P4 (inputs, B2.8 modal, B2.9 application) have their own plans.

## Global Constraints

- **Workdir / branch / base:** bundle branch `scnd-upgrades` in `/Users/shubhamkr/nos-scnd-upgrades`. **Bundle 1 executes elsewhere** — branch `scnd-upgrades-b1`, worktree `/Users/shubhamkr/nos-scnd-b1`, base `d3d4ee2`. P1 starts only after the lead has merged the **finished** Bundle 1 tip into `scnd-upgrades` (Step L0 under "Execution topology") and recorded that SHA as `B1_TIP`. Each task runs in its own pre-created locked worktree. The task's first Bash command is `cd <its worktree> && git rev-parse --abbrev-ref HEAD`; it must print `scu-2.p1.N-work`, otherwise STOP. Never touch `/Users/shubhamkr/network-optimization-studio`.
- **Base guard (every task, right after the branch check):** `B1_TIP=<the SHA recorded in L0>; git merge-base --is-ancestor "$B1_TIP" HEAD || exit 1` — a P1 task never runs on a base that lacks Bundle 1.
- **Dependencies:** a fresh worktree has no `node_modules` (measured: `/Users/shubhamkr/nos-scnd-upgrades/artifacts/studio/node_modules` does not exist). Run `pnpm install --frozen-lockfile` once in the task worktree before Step 1. pnpm only.
- **Before every `git commit`:** run `[ "$(git rev-parse --abbrev-ref HEAD)" != "main" ] || exit 1` **alone**, read its output, then commit **with an explicit pathspec** (`git commit <paths> -m …`). An untracked new file needs `git add <that file>` first (a pathspec commit cannot pick up an untracked file). Never pipe a state-changing git command.
- **One task = one commit.** Message `[SCU-2.P1.N] <imperative summary>`; the body ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Changelog in the same commit (hard rule #9).** SCU-2.P1.1 appends `## SCU-B2 — SCND upgrades Bundle 2 (2026-10-16 spec)` at the bottom of `docs/CHANGELOG-implementation.md`; every P1 task (including P1.1) appends its own `### SCU-2.P1.N — <title>`. Numbers come from that task's own run; anything not derivable is the literal string `unknown`. A cherry-pick conflict that is only two bottom-appended changelog blocks is resolved by keeping both, in task-id order.
- **Hard rule #12:** every task is owned by **frontend-engineer** and starts with Step 0: invoke `andrej-karpathy-skills:karpathy-guidelines`, then `ponytail:ponytail`, via the Skill tool; the report says both ran. Review: latest Opus + `ponytail:ponytail-review`.
- **Never edit generated code** (`lib/api-zod/src/generated/`, `lib/api-client-react/src/generated/`). P1 has no OpenAPI change; if a task seems to need one, STOP and escalate.
- **No server, solver or DB change.** `solve.py`, `e2e_accuracy.py`, `lib/db/**` are untouched; `e2e_accuracy.py` therefore does not need a P1 run.
- **No consumers in P1.** No Workspace tab, `pages/*.tsx` or `components/tables/{Warehouse,Customer,Mine,Station}Table.tsx` file changes. The only edit to an existing source file is the additive `triggerTestId` prop on `components/tables/FilterMenu.tsx` (default = today's literal). Therefore no testid or visible string in the running app changes and **no e2e spec is rewritten in P1**; each task proves this with the e2e sweep step.
- **Spec values, verbatim (B2.1, B2.2, B2.9):**
  - Page size **50**; the pager is rendered **only when filtered rows > 50**; Prev / "Page X of Y" / Next.
  - Filter menu top-right **when effective rows > 10** (all models); descriptors generated from `columns`; precedence: explicit `filter` → `kind: number` → range → `kind: enum` → select → `kind: text` → select if **≤ 20** distinct non-null values, else text.
  - `null`/`NaN` values match only an **"(empty)"** select option (internal token; display text "(empty)") and are **excluded from ranges**. Filtering uses `value()`, never display text. Descriptor ids = column ids. Base and added sections share **one** menu. Trigger testid `button-filter-menu-trigger` kept.
  - Pipeline order: effective rows (adapter) → filter → clamp page → slice 50. Filter change or row-set change resets to page 1 — rev 4: the row set is the order-insensitive key set of ALL effective rows and the filter state is canonicalised; a cell edit or reorder does not reset; a page beyond the end clamps to the last page; newly added rows append after base rows. Page size fixed, no override.
  - Focus jump (rev 4): clear every filter, then compute the page against the now-unfiltered effective list, navigate, scroll the row into view.
  - Rendering: `components/ui/table.tsx` primitives; `table-layout: auto`; uniform `px-3 py-1.5`; `whitespace-nowrap` headers; **`kind: "number"` header + cell centre-aligned**; no fixed widths.
  - `testIds` are an **explicit literal mapping per table — no auto-generated prefixes**.
  - `ctx: CellContext` = `{ readOnly, demandEditable, isOverridden(row), isChanged(row), isAdded(row) }`; the `ctx` prop is required (rev 4); `readOnly` applies to every editable cell in base, added and JADE rows (D2).
  - `FormattedNumberInput`: `<input type="text" inputMode="decimal">`; en-US grouping (`1,234.5`), reformats on each keystroke; caret preserved by counting significant characters (digits + decimal point); paste strips grouping commas and spaces and rejects other characters; no reformat during IME composition until `compositionend`; select-all + type replaces; leading zeros normalised; values above `Number.MAX_SAFE_INTEGER` rejected; `onChange(value: number | null)` with **`null` = empty = clear override (D3)**; negatives rejected; **decimals allowed**; visible suffix (e.g. "Units") **outside** the input, linked via `aria-describedby`; the input's `aria-label` unchanged — **none is added** (user decision 2026-10-17); `integer` mode for station demand.
- **Gate (every task; each script verified to exist: root `package.json:10` `typecheck`, `artifacts/studio/package.json:11` `typecheck:e2e`, `:12` `test`, `artifacts/api-server/package.json:12` `test`; `artifacts/api-server/src/solver/tests/` exists):**
  `pnpm run typecheck && pnpm --filter studio typecheck:e2e && pnpm --filter api-server test && pnpm --filter studio test && (cd artifacts/api-server/src/solver && python3 -m pytest tests/ -x)`
  Run each command separately and judge it by its own exit status. Before trusting a full suite, run `cnt=$(ps aux | grep "[v]itest" | grep -v "zsh -c" | wc -l | tr -d ' '); [ "$cnt" = "0" ]` alone; never chain it with `&&`. `pnpm --filter @workspace/import-schema test` joins the gate only once P2 creates that package.
- **Local DB:** `DATABASE_URL="postgresql://shubhamkr@localhost:5432/nos_dev"` inline on the `api-server test` command. `nos_dev` is shared with other sessions.
- **Flakes:** before calling a failure a regression, check `docs/superpowers/flake-registry.md` by test **name** and re-run the failing file twice in isolation. Record any new sighting there.
- **No merge, no push, no deploy.** Bundle 2 continues on this branch (P2 → P3 → P4).

## Spec deviations and grounding facts (read before any task)

Each is the smallest correct reading where the spec's text and the repo disagree (hard rule #8). The commit implementing it names it in its body. Evidence is in the matrix doc (§4 "API-gap resolution", §5 "Behaviour changes and open questions").

1. **The B2.1 prop list is extended, additively, so it can reproduce today's testids.** Measured against 30 table instances, the spec's `testIds { table?, row?(row), pager?, pageIndicator?, filterTrigger? }` cannot express Prev/Next button testids (`DistancesTab.tsx:225,238`, clicked by `bundle5-homepage-distances.spec.ts:180-183`), header-cell testids (`CostSummaryTab.tsx:463,514`), wrapper testids that contain the toolbar and `thead` (`JadeFlowsTab.tsx:435`, `CustomersTab.tsx:677`), toolbar testids (`chen-bands-units-qa.spec.ts:268`), always-on "X of Y" counters (`JadeAssignmentsTab.tsx:305`) or the in-tbody "No rows match" row (`DistancesTab.tsx:840-845`). P1 adds `testIds.{root, toolbar, scroll, count, pagerPrev, pagerNext, empty, noMatch}`, `ColumnDef.{filterLabel, headerTestId, cellClassName, hidden, filterResetKey}`, a `DataTableSection` shape (the spec names `sections` without one), `focus`, `scrollClassName`, `noMatchText` and `footer`. Nothing in the spec's list is renamed or removed; spec rev 4 (B2.1) points here for the authoritative signatures. Matrix §4 maps each field to its evidence (G1–G21).
2. **Focus jump = today's behaviour, and the spec now says so.** Rev 2's B2.2 said the page is computed "against the **filtered** list" while also requiring "existing behaviour is preserved"; today's code clears the filters first (`DistancesTab.tsx:459-467`, `JadeDistancesTab.tsx:494-503`). Spec rev 4 amended B2.2 to "clear every filter, then compute the page against the (now unfiltered) effective list". P1 implements and tests exactly that. Not a deviation any more; kept here for traceability.
3. **Page reset key = canonical filter state + the sorted key set of ALL effective rows** (`pageResetKey`, spec rev 4 B2.2). Adding/deleting any row — filtered in or out — resets; a cell edit (even one that moves a row in/out of the filter) or a reorder does not; equivalent filter states (key order, select-value order, `max: undefined` vs absent) produce the same key. Array identity is not used: the adapter rebuilds effective rows on every edit.
4. **`CellContext` is generic (`CellContext<T>`).** The spec writes `isOverridden(row)` etc. without a row type; a generic is the only way to type them.
5. **`ctx` is required** (`DataTableContext<T>` with required `readOnly` and `demandEditable`; row predicates optional, default "never"). An input adapter that forgot `ctx` would otherwise silently get `readOnly: false` and drop D2 or the Brazil lock. Enforced by a `@ts-expect-error` test under `pnpm run typecheck`. `demandEditable` stays table-wide: the Brazil lock is base-only (`CustomersTab.tsx:80-83`) and the P4 demand cell checks `ctx.isAdded(row)`.
6. **Filter-only columns.** `CapabilityMatrixTab.tsx:65` filters on `state`, which has no column; `ColumnDef.hidden` renders nothing but still derives a descriptor.
7. **Empty-option token.** `null`/`NaN` cells map to `EMPTY_FILTER_VALUE = "\u0000empty"` (new export of `lib/useTableFilters.ts`), not to the literal string `(empty)`, because `useTableFilters` compares select values by `String(value)` and a real cell reading `(empty)` would otherwise match the empty option. `FilterMenu` displays the token as `EMPTY_FILTER_LABEL = "(empty)"` and uses `__empty__` in `option-filter-*` / `checkbox-filter-*` testids.
8. **`FilterMenu` gains `triggerTestId?: string`** (default `"button-filter-menu-trigger"`) so `testIds.filterTrigger` can be honoured. With the empty-option label (7), these are the only changes to existing source files in P1.
9. **Page size is fixed.** `usePagedRows(rows, resetKey)` has no page-size parameter (spec rev 4: "fixed at 50; no override").
10. **B2.9's table-level tests belong to P4.** P1 builds `FormattedNumberInput` (with a pass-through `disabled` and an `integer` mode) and tests the component. "Brazil base locked vs added editable", "history disabled for base, added and JADE", "empty demand blocks add-customer submit" and the station-demand application are properties of the tables P4 migrates; see "Hand-off to P4".
11. **`FormattedNumberInput` emits `onChange` only when the parsed number changes.** Typing `12` → `12.` keeps the text `12.` and does not call `onChange(12)` twice — no spurious dirty flag.
12. **No aria-label is added** (user decision 2026-10-17, spec rev 4 B2.9). The P1 harness passes none, exactly like today's demand inputs (`CustomerTable.tsx:163-173`), and asserts the absence plus the `aria-describedby` link to the "Units" suffix.
13. **The spec's B2.1 text cited "the migration matrix, B2.9"**; the matrix is §B2.10 (fixed in spec rev 4).

## File Structure

| Path | Change | Task |
|---|---|---|
| `docs/superpowers/plans/2026-10-17-scnd-upgrades-bundle2-matrix.md` | **new** (already written at plan time; re-verified + committed) — the B2.10 matrix | P1.1 |
| `artifacts/studio/src/components/data-table/types.ts` | **new** — `ColumnKind`, `ColumnFilterKind`, `CellValue`, `CellContext<T>`, `ColumnDef<T>`, `DataTableTestIds<T>`, `DataTableToolbar`, `DataTableSection<T>`, `DataTableFocus<T>`, `DataTableProps<T>` | P1.2 |
| `artifacts/studio/src/lib/useTableFilters.ts` | add `EMPTY_FILTER_VALUE`, `EMPTY_FILTER_LABEL` (nothing else changes) | P1.2 |
| `artifacts/studio/src/components/data-table/deriveFilterDescriptors.ts` | **new** — `deriveFilterDescriptors`, `FILTER_ROW_THRESHOLD`, `SELECT_DISTINCT_MAX` | P1.2 |
| `artifacts/studio/src/__tests__/deriveFilterDescriptors.test.ts` | **new** | P1.2 |
| `artifacts/studio/src/components/data-table/usePagedRows.ts` | **new** — `PAGE_SIZE`, `PagedRows<T>`, `pageResetKey`, `usePagedRows` | P1.3 |
| `artifacts/studio/src/components/data-table/TablePager.tsx` | **new** — `TablePager`, `TablePagerProps`, `TablePagerTestIds` | P1.3 |
| `artifacts/studio/src/__tests__/usePagedRows.test.tsx` | **new** | P1.3 |
| `artifacts/studio/src/components/tables/FilterMenu.tsx` | add optional `triggerTestId` prop; show the empty token as "(empty)" / `__empty__` | P1.4 |
| `artifacts/studio/src/components/tables/FilterMenu.test.tsx` | import `EMPTY_FILTER_VALUE`; append 3 tests | P1.4 |
| `artifacts/studio/src/components/data-table/DataTable.tsx` | **new** — the shell | P1.4 |
| `artifacts/studio/src/__tests__/DataTable.test.tsx` | **new** | P1.4 |
| `artifacts/studio/src/__tests__/DataTable.distancesReplica.test.tsx` | **new** — real `DistancesTab` vs DataTable adapter testid parity | P1.5 |
| `artifacts/studio/src/components/data-table/FormattedNumberInput.tsx` | **new** — `FormattedNumberInput`, `sanitizeNumberText`, `groupNumberText`, `formatNumberValue` | P1.6 |
| `artifacts/studio/src/__tests__/FormattedNumberInput.test.tsx` | **new** | P1.6 |
| `docs/CHANGELOG-implementation.md` | `## SCU-B2` heading (P1.1) + one `### SCU-2.P1.N` per task | all |

Tests go in `artifacts/studio/src/__tests__/` (the dominant location); the `FilterMenu` tests stay colocated where they already live. `artifacts/studio/tsconfig.json` excludes `**/*.test.ts` but **includes** `*.test.tsx`, so the `.tsx` tests are type-checked by `pnpm run typecheck` — keep them type-clean.

## Interfaces (final — P3/P4 plans consume these exact names)

All in `artifacts/studio/src/components/data-table/`. Import paths: `@/components/data-table/<file>`.

```ts
// types.ts
// SCU-2.P1 (spec B2.1) — the public contract of the shared Workspace table
// shell. P3/P4 adapters are written against these types only; DataTable.tsx
// is the single renderer. Kept in its own file so an adapter module can
// import the types without importing React components.

import type { ReactNode } from "react";

/** Drives alignment (number → centred) and filter auto-derivation (B2.2). */
export type ColumnKind = "text" | "number" | "enum";

/** Explicit filter override. "range" maps to `useTableFilters`' "number". */
export type ColumnFilterKind = "text" | "select" | "range";

/** Raw value used for filtering and client export — never display text. */
export type CellValue = string | number | null;

/** What an adapter passes as `ctx`. `readOnly` and `demandEditable` are REQUIRED so an
 * adapter can never silently drop D2 history protection or the Brazil demand lock;
 * the row predicates default to "never" (no highlighting). */
export interface DataTableContext<T> {
  readOnly: boolean;
  demandEditable: boolean;
  isOverridden?: (row: T) => boolean;
  isChanged?: (row: T) => boolean;
  isAdded?: (row: T) => boolean;
}

/** Passed to every `cell` and `rowClassName` call (the adapter's ctx with predicates filled). */
export interface CellContext<T> {
  /** History browsing: every editable cell in base, added and JADE rows is disabled (D2). */
  readOnly: boolean;
  /** Brazil base demand lock (`!demandEditable` applies to base demand only). */
  demandEditable: boolean;
  isOverridden: (row: T) => boolean;
  isChanged: (row: T) => boolean;
  isAdded: (row: T) => boolean;
}

export interface ColumnDef<T> {
  /** Stable id. Also the filter descriptor key, so FilterMenu emits
   * `filter-control-{id}`, `input-filter-{id}`, `checkbox-filter-{id}-{value}`. */
  id: string;
  header: ReactNode;
  /** FilterMenu label. Defaults to `header` when it is a string, else `id`. */
  filterLabel?: string;
  kind: ColumnKind;
  cell: (row: T, ctx: CellContext<T>) => ReactNode;
  value: (row: T) => CellValue;
  /** Overrides auto-derivation; `false` = this column is not filterable. */
  filter?: false | ColumnFilterKind;
  /** data-testid on this column's <td> for `row`. */
  cellTestId?: (row: T) => string;
  /** data-testid on this column's <th>. */
  headerTestId?: string;
  /** Extra classes on the <td> (e.g. "font-mono text-xs"); alignment and padding are the shell's. */
  cellClassName?: string;
  /** Filter-only column: never rendered (no <th>/<td>), still gets a filter descriptor
   * (e.g. CapabilityMatrix `state`, `CapabilityMatrixTab.tsx:65`). */
  hidden?: boolean;
  /** When this value changes, ONLY this column's active filter is cleared (e.g. the
   * JADE `band` filter when bands or the unit change, `JadeAssignmentsTab.tsx:277-280`). */
  filterResetKey?: string | number;
}

/** Explicit literal testid mapping — nothing is auto-prefixed. Omitted = no attribute. */
export interface DataTableTestIds<T> {
  /** Outer wrapper <div> that holds toolbar + table(s) + pager. */
  root?: string;
  toolbar?: string;
  /** The <table> element (single-table mode; sections use `DataTableSection.tableTestId`). */
  table?: string;
  /** The scroll wrapper <div> around the <table> (single-table mode; sections use `scrollTestId`). */
  scroll?: string;
  /** Always-visible "{filtered} of {total}" counter in the toolbar (e.g. `text-jadeassignments-count`). Omitted = no counter. */
  count?: string;
  row?: (row: T) => string;
  pager?: string;
  pagerPrev?: string;
  pagerNext?: string;
  pageIndicator?: string;
  /** Defaults to FilterMenu's own `button-filter-menu-trigger`. */
  filterTrigger?: string;
  /** Element rendered when `rows` is empty. */
  empty?: string;
  /** The single full-width row rendered when the filter matches nothing. */
  noMatch?: string;
}

export interface DataTableToolbar {
  upload?: ReactNode;
  download?: ReactNode;
  add?: ReactNode;
  extra?: ReactNode;
  /** Where `download` renders: "left" (default, in slot order) or "right" (last,
   *  after the count and the filter trigger — output tables, user decision 2026-10-17). */
  downloadAlign?: "left" | "right";
}

/** Base + added rows rendered as titled groups under ONE toolbar, filter menu and pager. */
export interface DataTableSection<T> {
  id: string;
  title?: ReactNode;
  /** data-testid on the section wrapper <div>. */
  testId?: string;
  /** data-testid on this section's <table>. */
  tableTestId?: string;
  /** data-testid on this section's scroll wrapper <div>. */
  scrollTestId?: string;
  /** Classes for this section's scroll wrapper (base and added scroll independently today). */
  scrollClassName?: string;
  /** Row testid for this section; overrides `testIds.row`. */
  rowTestId?: (row: T) => string;
  /** A row renders in the FIRST section whose `includes` is true; a row matching none is not rendered. */
  includes: (row: T) => boolean;
  /** Section-specific columns (e.g. added rows carry a delete column). Defaults to the table's `columns`. */
  columns?: ColumnDef<T>[];
  /** Rendered after this section's table (e.g. an inline add-row form + its error text). Always rendered. */
  footer?: ReactNode;
  /** Rendered in place of this section's table when NO row in `rows` belongs to it. */
  emptyState?: ReactNode;
}

/** Focus jump (`DistancesTab.tsx:459-479`, `JadeDistancesTab.tsx:441-505`). A new
 * `token` clears every filter, moves to the page holding the first matching row
 * and scrolls that row into view. */
export interface DataTableFocus<T> {
  token: string | number;
  matches: (row: T) => boolean;
}

export interface DataTableProps<T> {
  /** Already-effective rows (base ⊕ saved overrides ⊕ current edits ⊕ added), base rows first. */
  rows: T[];
  /** Unique per row; composite keys allowed (e.g. `${fromId}|${toId}`). */
  rowKey: (row: T) => string;
  /** May be rebuilt each render; DataTable/FilterMenu must not key effects on this array's identity. */
  columns: ColumnDef<T>[];
  testIds?: DataTableTestIds<T>;
  rowClassName?: (row: T, ctx: CellContext<T>) => string | undefined;
  /** Required. Output tables pass `{ readOnly: true, demandEditable: false }` or the live flags. */
  ctx: DataTableContext<T>;
  toolbar?: DataTableToolbar;
  /** Rendered INSTEAD of table(s)/pager when `rows` is empty (toolbar slots still render).
   * With `sections` and no top-level emptyState, each section's own emptyState renders instead. */
  emptyState?: ReactNode;
  /** Text of the full-width row shown when the filter matches nothing. Default "No rows match the current filter." */
  noMatchText?: ReactNode;
  sections?: DataTableSection<T>[];
  focus?: DataTableFocus<T> | null;
  /** Classes for the scroll wrapper around the table (single-table mode), e.g. "max-h-[55vh] overflow-y-auto". */
  scrollClassName?: string;
  /** Rendered inside the root after the pager (e.g. CostSummary's bands note). */
  footer?: ReactNode;
}
```

```ts
// lib/useTableFilters.ts (existing; two additive exports)
export const EMPTY_FILTER_VALUE = "\u0000empty"; // select-option value for null/NaN cells
export const EMPTY_FILTER_LABEL = "(empty)";      // what FilterMenu displays for it

// deriveFilterDescriptors.ts — consumes ColumnFilterDescriptor<T> / ColumnFilterType / EMPTY_FILTER_VALUE from "@/lib/useTableFilters"
export const FILTER_ROW_THRESHOLD = 10;
export const SELECT_DISTINCT_MAX = 20;
export function deriveFilterDescriptors<T>(columns: ColumnDef<T>[], rows: T[]): ColumnFilterDescriptor<T>[];

// usePagedRows.ts
export const PAGE_SIZE = 50;
export interface PagedRows<T> { page: number; pageCount: number; pageRows: T[]; showPager: boolean; setPage: (page: number, forResetKey?: string) => void; }
export function pageResetKey<T>(rows: T[], rowKey: (row: T) => string, filterState: FilterState): string;
export function usePagedRows<T>(rows: T[], resetKey: string): PagedRows<T>; // page size fixed at 50

// TablePager.tsx
export interface TablePagerTestIds { pager?: string; prev?: string; next?: string; indicator?: string; }
export interface TablePagerProps { page: number; pageCount: number; onPageChange: (page: number) => void; testIds?: TablePagerTestIds; }
export function TablePager(props: TablePagerProps): JSX.Element;

// DataTable.tsx
export function DataTable<T>(props: DataTableProps<T>): JSX.Element;

// FormattedNumberInput.tsx
export interface FormattedNumberInputProps
  extends Omit<React.ComponentProps<"input">, "value" | "defaultValue" | "onChange" | "type" | "inputMode"> {
  value: number | null;
  onChange: (value: number | null) => void;
  suffix?: string;
  integer?: boolean; // station demand: "." rejected, inputMode "numeric"
  "data-testid"?: string;
}
export const FormattedNumberInput: React.ForwardRefExoticComponent<FormattedNumberInputProps & React.RefAttributes<HTMLInputElement>>;
export function sanitizeNumberText(raw: string, integer?: boolean): string | null;
export function groupNumberText(s: string): string;
export function formatNumberValue(value: number | null): string;

// components/tables/FilterMenu.tsx (existing; one additive prop + empty-option display)
export interface FilterMenuProps<T> { /* …existing… */ triggerTestId?: string; } // default "button-filter-menu-trigger"
// option whose value === EMPTY_FILTER_VALUE renders text "(empty)", testids option-filter-{key}-__empty__ / checkbox-filter-{key}-__empty__
```

**Adapter rules P3/P4 rely on (enforced by P1 tests):**
- `cell()` output is placed **directly** in the `<td>` (no wrapper). `cellTestId` goes on the `<td>`; `headerTestId` on the `<th>`; `testIds.row` on the `<tr>`; `testIds.table` on the `<table>`; `testIds.scroll` on the scroll `<div>`; `testIds.root` on the outermost `<div>` (holds toolbar, table(s), pager, footer).
- An omitted testid emits **no** `data-testid` attribute. Nothing is derived from `rowKey`.
- Each `<tr>` carries `data-row-key={rowKey(row)}` (used for the focus scroll; not a testid).
- Toolbar order: `upload`, `download`, `add`, `extra`, then right-aligned `count` and the filter trigger; with `toolbar.downloadAlign: "right"` (output tables) `download` renders last, after the filter trigger. The toolbar row renders when any slot, `testIds.toolbar`, `testIds.count` or the filter menu is present.
- Adapters may rebuild `columns` each render; DataTable and FilterMenu must not key effects on column identity (a new `columns` array with the same ids keeps the filter state and the page — P1.4 test).
- `ctx` is required: input adapters pass the live `{ readOnly: isBrowsingHistoryNow, demandEditable, isOverridden, isChanged, isAdded }`; output adapters pass `{ readOnly: true, demandEditable: false }`.
- Editable cells with draft state are components returned from `cell()` (matrix G16).
- Inputs rendered inside cells carry `w-full` and no fixed width (B2.1 rendering); `FormattedNumberInput` already does.

## Execution topology

Dependency graph:
- **P1.1** (matrix) depends on nothing.
- **P1.2** (types + filter derivation) and **P1.3** (paging) depend on nothing.
- **P1.4** (DataTable + FilterMenu prop) depends on P1.2 and P1.3.
- **P1.5** (replica harness) depends on P1.4.
- **P1.6** (FormattedNumberInput) depends on nothing.

**Step L0 (lead, once, before wave A) — bring the finished Bundle 1 onto the bundle branch:**

```bash
git -C /Users/shubhamkr/nos-scnd-b1 status --short            # must be empty
git -C /Users/shubhamkr/nos-scnd-upgrades log --oneline d3d4ee2..scnd-upgrades-b1   # every [SCU-1.N] commit present, N = 1…11
B1_TIP=$(git -C /Users/shubhamkr/nos-scnd-upgrades rev-parse scnd-upgrades-b1)
cd /Users/shubhamkr/nos-scnd-upgrades && git rev-parse --abbrev-ref HEAD     # must print scnd-upgrades
git merge --ff-only "$B1_TIP" || git merge --no-ff "$B1_TIP" -m "[scnd-upgrades] merge Bundle 1 (scnd-upgrades-b1 @ ${B1_TIP:0:7}) before Bundle 2 P1"
git merge-base --is-ancestor "$B1_TIP" HEAD && echo "B1 on bundle branch"
```

`scnd-upgrades` carries planning commits Bundle 1 does not (this plan, P2's), so expect `--ff-only` to fail and the `--no-ff` merge to run; any conflict outside `docs/` is a STOP-and-ask. Record `B1_TIP` (full SHA) in the dispatch brief of every P1 task and in SCU-2.P1.1's changelog entry. Then run the full gate once on the merged tip.

| Wave | Tasks | Base |
|---|---|---|
| A | P1.1, P1.2, P1.3, P1.6 | `scnd-upgrades` tip after L0 |
| B | P1.4 | tip after wave A is cherry-picked |
| C | P1.5 | tip after P1.4 |

Wave A's tasks touch disjoint files except the changelog (bottom-append; keep both blocks in task-id order).

**Do NOT rely on `isolation: "worktree"`** (root CLAUDE.md gotcha). For each task the controller pre-creates a locked worktree from the wave's base:

```bash
BASE=$(git -C /Users/shubhamkr/nos-scnd-upgrades rev-parse scnd-upgrades)
git -C /Users/shubhamkr/nos-scnd-upgrades worktree add --lock /Users/shubhamkr/nos-scu-2.p1.N -b scu-2.p1.N-work "$BASE"
```

The controller dispatches **without** `isolation`. The agent's first Bash command is `cd /Users/shubhamkr/nos-scu-2.p1.N && git rev-parse --abbrev-ref HEAD` (must print `scu-2.p1.N-work`), then the two base guards, each alone: `git merge-base --is-ancestor "$BASE" HEAD || exit 1` and `git merge-base --is-ancestor "$B1_TIP" HEAD || exit 1`. The controller cherry-picks each task commit onto `scnd-upgrades` in task-id order and re-runs the gate on the bundle branch before the next wave.

---

## Task SCU-2.P1.1: Migration matrix — regenerate every reference at the Bundle 1 tip and commit (B2.10)

**Owner role:** frontend-engineer (read-only verification of studio code; edits docs only). **Spec:** §B2.10, "Risks and mitigations — e2e breakage". **Deviations:** 13.

**Files:**
- Modify + commit: `docs/superpowers/plans/2026-10-17-scnd-upgrades-bundle2-matrix.md` (measured at `46d2f98`; this task moves it to `B1_TIP`)
- Modify: `docs/CHANGELOG-implementation.md` (append `## SCU-B2` heading + `### SCU-2.P1.1`)
- Scratch only (never committed): three scripts under `$TMPDIR`

**Interfaces:**
- Consumes: `B1_TIP` from Step L0.
- Produces: the matrix with §1 Summary (30 rows), §2 Instance records, §3 e2e selector inventory, §4 API-gap resolution (G1–G21), §5 behaviour changes + user decisions Q1–Q4, every `file:line` valid at `B1_TIP`. P3/P4 plans cite it by section and instance name.

**Why mechanical:** Bundle 1 edits nine studio source files and several e2e specs that the matrix cites by line. Re-typing ~900 references by hand is how stale ones survive. `git diff -U0 46d2f98 B1_TIP` gives, for every file, exactly which old lines moved and which were edited: references into unchanged files are exact by construction, moved lines follow their code, and only references to edited/deleted lines need a human — each is re-located by the quoted text the matrix carries next to it.

- [ ] **Step 0: Invoke the simplicity skills**

Skill tool: `andrej-karpathy-skills:karpathy-guidelines`, then `ponytail:ponytail`. Record in the report that both ran.

- [ ] **Step 1: List what Bundle 1 changed**

Run: `git diff --name-only 46d2f98 "$B1_TIP" -- artifacts/studio/src artifacts/studio/e2e`
Expected: a non-empty list including `components/workspace/tabs/{ServiceStatsTab,CostSummaryTab,OpenWarehousesTab,AssignmentsTab,JadeAssignmentsTab,FlowsTab,JadeFlowsTab,InputMapTab}.tsx`, `pages/Workspace.tsx` and the e2e specs Bundle 1 rewrote. **An empty list means `B1_TIP` is wrong — STOP.**

- [ ] **Step 2: Remap every line reference in §1, §2, §4, §5**

Write this script to `$TMPDIR/scu-remap.py`:

```python
# SCU-2.P1.1 — remaps every line reference in the matrix from OLD to NEW
# through `git diff -U0 OLD NEW`, so references into files that did not
# change stay exact and references into changed files move with their code.
# A reference whose line was itself edited or deleted is left as-is and
# REPORTED on stderr for manual re-location by its quoted text.
#
# Usage: python3 scu-remap.py <matrix.md> <OLD> <NEW> > matrix.new.md 2> remap-report.txt
#
# Reference forms handled (outside §3, which is regenerated separately):
#   `path/File.tsx:123`, `File.tsx:12-34`, `File.tsx:1,5-9`   explicit file
#   `:123`, `:12-34`                                           bare, bound to the most recent explicit
#                                                              file on the same line, else the record's
#                                                              default file
#   | testid | element | 752 |  /  | … | 667 / 674 / 689 |    testid-table line column (record's default file)
# Default file: the first explicit file on a §1 summary row; else the first file on the record's
# "- **File:**" line (a `#### ` record in §2).
import re, subprocess, sys

matrix_path, OLD, NEW = sys.argv[1], sys.argv[2], sys.argv[3]
ROOT = subprocess.check_output(["git", "rev-parse", "--show-toplevel"], text=True).strip()
PREFIXES = ["", "artifacts/studio/src/", "artifacts/studio/", "artifacts/studio/e2e/",
            "artifacts/studio/src/components/workspace/tabs/", "artifacts/studio/src/components/tables/",
            "artifacts/studio/src/pages/", "artifacts/studio/src/__tests__/"]
FILES = subprocess.check_output(["git", "ls-tree", "-r", "--name-only", OLD], text=True, cwd=ROOT).split("\n")
FILESET = set(FILES)
_resolved, _hunks = {}, {}

def resolve(p):
    if p in _resolved:
        return _resolved[p]
    hit = next((pre + p for pre in PREFIXES if pre + p in FILESET), None)
    if hit is None:
        cands = [f for f in FILES if f.endswith("/" + p)]
        hit = cands[0] if len(cands) == 1 else None
    _resolved[p] = hit
    return hit

def hunks(path):
    if path not in _hunks:
        out = subprocess.check_output(["git", "diff", "-U0", OLD, NEW, "--", path], text=True, cwd=ROOT)
        hs = []
        for m in re.finditer(r"^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@", out, re.M):
            a, b = int(m.group(1)), int(m.group(2) or 1)
            c, d = int(m.group(3)), int(m.group(4) or 1)
            hs.append((a, b, c, d))
        _hunks[path] = hs
    return _hunks[path]

report = []

def map_line(path, n, docline):
    shift = 0
    for a, b, c, d in hunks(path):
        if b == 0:            # pure insertion after old line a
            if n > a:
                shift += d
            continue
        if a <= n < a + b:    # the referenced line itself was edited/deleted
            report.append(f"{docline}: {path}:{n} — line changed between {OLD[:7]}..{NEW[:7]}; re-locate by its quoted text")
            return n
        if n >= a + b:
            shift += d - b
    return n + shift

def map_nums(path, nums, docline):
    def one(m):
        return str(map_line(path, int(m.group(0)), docline))
    return re.sub(r"\d+", one, nums)

EXPLICIT = re.compile(r"`([A-Za-z0-9_./-]+\.(?:tsx|ts|py|json|yaml|md)):(\d+(?:[-–]\d+)?(?:,\s?\d+(?:[-–]\d+)?)*)")
BARE = re.compile(r"(?<![A-Za-z0-9_.])`:(\d+(?:[-–]\d+)?(?:,\s?\d+(?:[-–]\d+)?)*)`|\(:(\d+(?:[-–]\d+)?(?:,\s?\d+(?:[-–]\d+)?)*)\)|(?<=[\s(,])`?:(\d+(?:[-–]\d+)?(?:,\d+(?:[-–]\d+)?)*)(?=[`),;\s])")

lines = open(matrix_path).read().split("\n")
out, default, section = [], None, None
for i, line in enumerate(lines, 1):
    if line.startswith("## "):
        section = line[3:5]
    if section == "3.":
        out.append(line)
        continue
    if line.startswith("#### "):
        default = None
    if line.startswith("- **File:**"):
        m = EXPLICIT.search(line) or re.search(r"`([A-Za-z0-9_./-]+\.tsx?)", line)
        default = resolve(m.group(1)) if m else default
    row_default = default
    if section == "1." and re.match(r"^\| \d+ \|", line):
        m = EXPLICIT.search(line)
        row_default = resolve(m.group(1)) if m else None

    # Walk the line, rewriting explicit and bare refs in order.
    pos, buf, current = 0, [], row_default
    tokens = sorted(
        [(m.start(), m.end(), "x", m) for m in EXPLICIT.finditer(line)]
        + [(m.start(), m.end(), "b", m) for m in BARE.finditer(line)],
        key=lambda t: t[0],
    )
    last_end = -1
    for start, end, kind, m in tokens:
        if start < last_end:
            continue
        buf.append(line[pos:start])
        seg = line[start:end]
        if kind == "x":
            path = resolve(m.group(1))
            if path:
                current = path
                seg = seg[: m.start(2) - start] + map_nums(path, m.group(2), i) + seg[m.end(2) - start:]
        else:
            g = next(k for k in (1, 2, 3) if m.group(k))
            if current:
                seg = seg[: m.start(g) - start] + map_nums(current, m.group(g), i) + seg[m.end(g) - start:]
        buf.append(seg)
        pos = last_end = end
    buf.append(line[pos:])
    new = "".join(buf)

    # Testid-table line column (last cell of a 3-column §2 table row).
    cells = new.split("|")
    if section == "2." and len(cells) == 5 and default and re.fullmatch(r"\s*\d+(?:\s*(?:/|,|[-–])\s*\d+)*\s*", cells[3]):
        cells[3] = map_nums(default, cells[3], i)
        new = "|".join(cells)
    out.append(new)

sys.stdout.write("\n".join(out))
sys.stderr.write("\n".join(report) + ("\n" if report else ""))
sys.stderr.write(f"{len(report)} reference(s) need manual re-location\n")
```

Run (from the worktree root):
`python3 $TMPDIR/scu-remap.py docs/superpowers/plans/2026-10-17-scnd-upgrades-bundle2-matrix.md 46d2f98 "$B1_TIP" > $TMPDIR/matrix.remapped.md 2> $TMPDIR/remap-report.txt; tail -1 $TMPDIR/remap-report.txt`
Expected: `N reference(s) need manual re-location` (N ≥ 0). Sanity check run at plan time: `46d2f98 → 46d2f98` printed `0 reference(s)` and reproduced the file byte-for-byte; `46d2f98 → 917bc88` (an older DistancesTab) mapped `row-distance-*` 752 → 749, and `git show 917bc88:…/DistancesTab.tsx | sed -n 749p` is that testid's line.
Then `cp $TMPDIR/matrix.remapped.md docs/superpowers/plans/2026-10-17-scnd-upgrades-bundle2-matrix.md`.

- [ ] **Step 3: Resolve every reported reference by its quoted text**

For each line of `$TMPDIR/remap-report.txt` (`<doc line>: <path>:<old line> — line changed…`): open the matrix at `<doc line>`, read the quoted text/testid it cites, find it at `B1_TIP` (`git show "$B1_TIP":<path> | grep -n '<quoted text>'`), and write the new line number. If Bundle 1 deleted the thing (e.g. a removed tab-level title), delete the reference or the testid-table row and write "(removed by Bundle 1 SCU-1.N)"; if Bundle 1 added a testid the instance now emits (e.g. `button-toggle-compare`, `output-map-narrative`), add a row with "(Bundle 1 SCU-1.N)". Count what you resolved; it must equal N from Step 2.

- [ ] **Step 4: Check every §2 testid-table row against the code at `B1_TIP`**

Write this script to `$TMPDIR/scu-check.py`:

```python
# SCU-2.P1.1 — checks every §2 testid-table row against the code at REV: the
# testid's static prefix (text before the first `{`, `${` or `|`) must appear on
# the cited line of the record's default file (or of the file the element cell names).
# Usage: python3 scu-check.py <matrix.md> <REV>   → prints mismatches; exit 1 if any.
# Known, legitimate mismatches (10 at 46d2f98): a row citing a `<FilterMenu` mount line for
# `button-filter-menu-trigger`, a row citing an `idPrefix`/template line (`button-${idPrefix}-prev`),
# and an abbreviated testid ending in `…`. Every other mismatch is a stale reference.
import re, subprocess, sys

matrix_path, REV = sys.argv[1], sys.argv[2]
ROOT = subprocess.check_output(["git", "rev-parse", "--show-toplevel"], text=True).strip()
FILES = subprocess.check_output(["git", "ls-tree", "-r", "--name-only", REV], text=True, cwd=ROOT).split("\n")
PREFIXES = ["", "artifacts/studio/src/", "artifacts/studio/", "artifacts/studio/e2e/",
            "artifacts/studio/src/components/workspace/tabs/", "artifacts/studio/src/components/tables/",
            "artifacts/studio/src/pages/"]
cache = {}

def resolve(p):
    hit = next((pre + p for pre in PREFIXES if pre + p in FILES), None)
    if hit is None:
        c = [f for f in FILES if f.endswith("/" + p)]
        hit = c[0] if len(c) == 1 else None
    return hit

def text(path):
    if path not in cache:
        cache[path] = subprocess.check_output(["git", "show", f"{REV}:{path}"], text=True, cwd=ROOT).split("\n")
    return cache[path]

bad, checked, default, section = [], 0, None, None
for i, line in enumerate(open(matrix_path).read().split("\n"), 1):
    if line.startswith("## "):
        section = line[3:5]
    if section != "2.":
        continue
    if line.startswith("#### "):
        default = None
    if line.startswith("- **File:**"):
        m = re.search(r"`([A-Za-z0-9_./-]+\.tsx?)", line)
        default = resolve(m.group(1)) if m else None
    cells = line.split("|")
    if len(cells) != 5 or not default or not re.fullmatch(r"\s*\d+\s*", cells[3]):
        continue
    ids = re.findall(r"`([^`]+)`", cells[1])
    if not ids:
        continue
    named = re.search(r"`([A-Za-z0-9_./-]+\.tsx?)", cells[2])
    path = resolve(named.group(1)) if named and resolve(named.group(1)) else default
    n = int(cells[3])
    prefix = re.split(r"[{$|]", ids[0])[0].rstrip("-")
    src = text(path)
    checked += 1
    window = src[n - 1] if 0 < n <= len(src) else ""
    if prefix and prefix not in window:
        got = src[n - 1].strip()[:90] if n - 1 < len(src) else "EOF"
        bad.append(f"{i}: {path}:{n} does not contain `{prefix}` → {got}")
print("\n".join(bad))
print(f"checked {checked} testid-table rows, {len(bad)} mismatch(es)")
sys.exit(1 if bad else 0)
```

Run: `python3 $TMPDIR/scu-check.py docs/superpowers/plans/2026-10-17-scnd-upgrades-bundle2-matrix.md "$B1_TIP"`
Expected: the last line is `checked 152 testid-table rows, M mismatch(es)` (152 at plan time; ± the rows Step 3 added or removed), and every printed mismatch is one of the three legitimate kinds named in the script header (a `<FilterMenu` mount line, an `idPrefix`/template line, an abbreviated `…` testid). At `46d2f98` there were exactly 10, all of those kinds. Fix every other mismatch, then re-run until only those remain.

- [ ] **Step 5: Regenerate §3 (e2e inventory)**

Write this script to `$TMPDIR/scu-inv.py`:

```python
# SCU-2.P1.1 — regenerates matrix §3 from the testid maps in matrix §2.
# Usage: python3 scu-inv.py <matrix.md> <artifacts/studio/e2e>
import collections, os, re, sys

matrix_path, e2e = sys.argv[1], sys.argv[2]
SHARED = ["button-clear-all-filters", "button-clear-filter-", "button-filter-menu-trigger", "checkbox-filter-",
          "filter-control-", "filter-menu-popover", "input-filter-", "option-filter-", "select-filter-",
          "text-filter-active-count", "text-filter-count"]

# 1. testid prefixes per instance, from §2 only (between "## 2." and "## 3.").
lines = open(matrix_path).read().split("\n")
start = next(i for i, l in enumerate(lines) if l.startswith("## 2."))
end = next(i for i, l in enumerate(lines) if l.startswith("## 3."))
prefixes = collections.OrderedDict()
sec = None
for line in lines[start:end]:
    if line.startswith("#### "):
        sec = line[5:].strip()
        prefixes.setdefault(sec, set())
        continue
    cand = []
    if sec and line.startswith("|") and "`" in line.split("|")[1]:
        cand = re.findall(r"`([^`]+)`", line.split("|")[1])
    elif sec and line.startswith("- **Testid map:**"):
        cand = re.findall(r"`([^`]+)`", line)
    for t in cand:
        p = re.split(r"[{$|]", t)[0]
        if len(p) >= 6 and re.match(r"^[a-z][a-z0-9-]*$", p.rstrip("-")):
            prefixes[sec].add(p)
for k in prefixes:
    prefixes[k] -= set(SHARED)
prefixes["Shared FilterMenu testids (every table with a filter today; FilterMenu.tsx)"] = set(SHARED)

# 2. e2e files: *.spec.ts (minus dead labs.spec.ts) + helpers/**.
texts = {}
for f in sorted(os.listdir(e2e)):
    if f.endswith(".spec.ts") and f != "labs.spec.ts":
        texts[f] = open(os.path.join(e2e, f)).read().split("\n")
for root, _, fs in os.walk(os.path.join(e2e, "helpers")):
    for f in sorted(fs):
        p = os.path.join(root, f)
        texts["helpers/" + os.path.relpath(p, os.path.join(e2e, "helpers"))] = open(p).read().split("\n")

# 3. plain-substring grep, grouped by instance.
for sec, prefs in prefixes.items():
    if not prefs:
        continue
    hits = collections.defaultdict(set)
    for f, ls in texts.items():
        for i, l in enumerate(ls, 1):
            if any(p in l for p in prefs):
                hits[f].add(i)
    print(f"#### {sec}\n- prefixes grepped ({len(prefs)}): " + ", ".join(f"`{p}`" for p in sorted(prefs)))
    if not hits:
        print("- e2e hits: none (grep run)\n")
        continue
    print(f"- e2e hits: {sum(len(v) for v in hits.values())} lines in {len(hits)} files")
    for f in sorted(hits):
        print(f"  - `{f}`: " + ", ".join(map(str, sorted(hits[f]))))
    print()
```

Run: `python3 $TMPDIR/scu-inv.py docs/superpowers/plans/2026-10-17-scnd-upgrades-bundle2-matrix.md artifacts/studio/e2e > $TMPDIR/inv.md && grep -c '^#### ' $TMPDIR/inv.md`
Expected: `30` (29 instances with testids — Refineries-added shares Warehouses-added's — plus the shared FilterMenu group; at `46d2f98` this reproduced §3 exactly). Replace the body of §3 from its first `#### ` line up to the line before `## 4.` with `$TMPDIR/inv.md`.

- [ ] **Step 6: Update the provenance line and confirm the counts**

Replace the "**Measured at `46d2f98`**" opening of the document with "**Measured at `46d2f98`, every reference regenerated at `<B1_TIP short SHA>` by SCU-2.P1.1**". Then run each and compare with the "Counts" paragraph:
- `grep -c '^| [0-9]* | P[34] |' docs/superpowers/plans/2026-10-17-scnd-upgrades-bundle2-matrix.md` → `30`
- `ls artifacts/studio/e2e/*.spec.ts | wc -l` → the spec-file count (30 at `46d2f98`; update the doc if Bundle 1 added one)

- [ ] **Step 7: e2e sweep**

This task changes no source file. Record `e2e: n/a (docs only)` in the changelog.

- [ ] **Step 8: Gate**

Docs-only change; the gate still runs so the task's base is proven green. Run each separately:
1. `cnt=$(ps aux | grep "[v]itest" | grep -v "zsh -c" | wc -l | tr -d ' '); [ "$cnt" = "0" ]`
2. `pnpm run typecheck`
3. `pnpm --filter studio typecheck:e2e`
4. `DATABASE_URL="postgresql://shubhamkr@localhost:5432/nos_dev" pnpm --filter api-server test`
5. `pnpm --filter studio test`
6. `(cd artifacts/api-server/src/solver && python3 -m pytest tests/ -x)`

Expected: every command exits 0.

- [ ] **Step 9: Changelog**

Append to the bottom of `docs/CHANGELOG-implementation.md`:

```markdown

## SCU-B2 — SCND upgrades Bundle 2 (2026-10-16 spec)

Plans: P1 `docs/superpowers/plans/2026-10-17-scnd-upgrades-bundle2-p1.md`; matrix `docs/superpowers/plans/2026-10-17-scnd-upgrades-bundle2-matrix.md`. Spec: `docs/superpowers/specs/2026-10-16-scnd-upgrades-design.md` (rev 4), Bundle 2 + D1–D6. Bundle 1 merged onto `scnd-upgrades` by the lead (Step L0): `scnd-upgrades-b1` @ <B1_TIP>, merge commit <SHA or "fast-forward">.

### SCU-2.P1.1 — B2.10 migration matrix

- 30 table instances (9 outputs, 7 distance/cost inputs, 14 entity inputs) + 2 excluded surface groups; complete testid maps; every reference regenerated 46d2f98 → <B1_TIP short>: <N> remapped automatically, <K> re-located by quoted text; testid-row check <checked>/<mismatches, all legitimate>; e2e inventory <groups> groups.
- API gaps G1–G21 resolved additively in the P1 interfaces (plan deviation 1). User decisions Q1–Q4 (2026-10-17) recorded in §5.
- Gate: studio <N passed>, api-server <N passed>, pytest <N passed>. e2e: n/a (docs only).
```

Replace each `<…>` with the value measured in this run, or the literal `unknown`.

- [ ] **Step 10: Commit**

```bash
[ "$(git rev-parse --abbrev-ref HEAD)" != "main" ] || exit 1
```

```bash
git commit docs/superpowers/plans/2026-10-17-scnd-upgrades-bundle2-matrix.md docs/CHANGELOG-implementation.md -m "[SCU-2.P1.1] regenerate Bundle 2 migration matrix at the Bundle 1 tip" -m "Every file:line remapped 46d2f98..B1_TIP via git diff; edited lines re-located by quoted text; §3 regenerated. Deviation 13." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task SCU-2.P1.2: DataTable contract types + filter auto-derivation (B2.1 types, B2.2 "Filter")

**Owner role:** frontend-engineer. **Spec:** B2.1 props; B2.2 "Filter". **Deviations:** 1, 4, 5, 6, 7.

**Files:**
- Modify: `artifacts/studio/src/lib/useTableFilters.ts:14` (insert two constants after `export type ColumnFilterType …`; nothing else changes)
- Create: `artifacts/studio/src/components/data-table/types.ts`
- Create: `artifacts/studio/src/components/data-table/deriveFilterDescriptors.ts`
- Test: `artifacts/studio/src/__tests__/deriveFilterDescriptors.test.ts`
- Modify: `docs/CHANGELOG-implementation.md` (append `### SCU-2.P1.2`)

**Interfaces:**
- Consumes (`artifacts/studio/src/lib/useTableFilters.ts`, otherwise unchanged): `ColumnFilterDescriptor<T> = { key: string; label: string; type: ColumnFilterType; accessor: (row: T) => string | number | undefined }`, `ColumnFilterType = "text" | "select" | "number"`, `useTableFilters<T>(rows, descriptors): UseTableFiltersResult<T>`. Note `useTableFilters` excludes `undefined` from select options and from active ranges, and treats it as `""` for text.
- Produces: everything in `types.ts` (see "Interfaces" above, verbatim), and `deriveFilterDescriptors<T>(columns: ColumnDef<T>[], rows: T[]): ColumnFilterDescriptor<T>[]`, `FILTER_ROW_THRESHOLD = 10`, `SELECT_DISTINCT_MAX = 20`; in `useTableFilters.ts`: `EMPTY_FILTER_VALUE = "\u0000empty"`, `EMPTY_FILTER_LABEL = "(empty)"`.

- [ ] **Step 0: Invoke the simplicity skills**

Skill tool: `andrej-karpathy-skills:karpathy-guidelines`, then `ponytail:ponytail`. Record in the report that both ran.

- [ ] **Step 1: Write the failing test**

Create `artifacts/studio/src/__tests__/deriveFilterDescriptors.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { renderHook, act } from "@testing-library/react";
import {
  deriveFilterDescriptors,
  FILTER_ROW_THRESHOLD,
  SELECT_DISTINCT_MAX,
} from "@/components/data-table/deriveFilterDescriptors";
import type { ColumnDef } from "@/components/data-table/types";
import { EMPTY_FILTER_LABEL, EMPTY_FILTER_VALUE, useTableFilters } from "@/lib/useTableFilters";

interface Row {
  id: string;
  city: string | null;
  distance: number | null;
  status: "open" | "closed";
}

const col = (over: Partial<ColumnDef<Row>> & Pick<ColumnDef<Row>, "id" | "kind" | "value">): ColumnDef<Row> => ({
  header: over.id,
  cell: () => null,
  ...over,
});

const rows: Row[] = [
  { id: "W1", city: "Austin", distance: 10, status: "open" },
  { id: "W2", city: null, distance: null, status: "closed" },
  { id: "W3", city: "Boston", distance: Number.NaN, status: "open" },
];

describe("deriveFilterDescriptors — spec constants", () => {
  it("pins the spec's thresholds", () => {
    expect(FILTER_ROW_THRESHOLD).toBe(10);
    expect(SELECT_DISTINCT_MAX).toBe(20);
    expect(EMPTY_FILTER_LABEL).toBe("(empty)");
  });

  it("the empty token is not a printable string any cell could hold", () => {
    expect(EMPTY_FILTER_VALUE).not.toBe(EMPTY_FILTER_LABEL);
    expect(EMPTY_FILTER_VALUE.charCodeAt(0)).toBe(0);
  });
});

describe("deriveFilterDescriptors — precedence", () => {
  it("explicit filter wins over kind", () => {
    const d = deriveFilterDescriptors(
      [
        col({ id: "a", kind: "number", value: r => r.distance, filter: "select" }),
        col({ id: "b", kind: "text", value: r => r.city, filter: "range" }),
        col({ id: "c", kind: "enum", value: r => r.status, filter: "text" }),
      ],
      rows,
    );
    expect(d.map(x => [x.key, x.type])).toEqual([["a", "select"], ["b", "number"], ["c", "text"]]);
  });

  it("filter: false drops the column", () => {
    const d = deriveFilterDescriptors([col({ id: "a", kind: "text", value: r => r.id, filter: false })], rows);
    expect(d).toEqual([]);
  });

  it("number → range, enum → select", () => {
    const d = deriveFilterDescriptors(
      [col({ id: "dist", kind: "number", value: r => r.distance }), col({ id: "status", kind: "enum", value: r => r.status })],
      rows,
    );
    expect(d.map(x => x.type)).toEqual(["number", "select"]);
  });

  it("text → select at exactly 20 distinct non-null values, text at 21; nulls not counted", () => {
    const make = (n: number): Row[] => [
      ...Array.from({ length: n }, (_, i) => ({ id: `W${i}`, city: `City${i}`, distance: i, status: "open" as const })),
      { id: "WX", city: null, distance: null, status: "open" as const },
    ];
    const c = col({ id: "city", kind: "text", value: r => r.city });
    expect(deriveFilterDescriptors([c], make(20))[0].type).toBe("select");
    expect(deriveFilterDescriptors([c], make(21))[0].type).toBe("text");
  });
});

describe("deriveFilterDescriptors — ids, labels, accessors", () => {
  it("descriptor key = column id; label = string header, else filterLabel, else id", () => {
    const d = deriveFilterDescriptors(
      [
        col({ id: "from", kind: "text", value: r => r.id, header: "From" }),
        col({ id: "base", kind: "number", value: r => r.distance, header: null, filterLabel: "Base (mi)" }),
        col({ id: "raw", kind: "number", value: r => r.distance, header: null }),
      ],
      rows,
    );
    expect(d.map(x => [x.key, x.label])).toEqual([["from", "From"], ["base", "Base (mi)"], ["raw", "raw"]]);
  });

  it("select maps null and NaN to the (empty) option; range and text map them to undefined", () => {
    const [sel, rng, txt] = deriveFilterDescriptors(
      [
        col({ id: "s", kind: "number", value: r => r.distance, filter: "select" }),
        col({ id: "r", kind: "number", value: r => r.distance }),
        col({ id: "t", kind: "text", value: r => r.city, filter: "text" }),
      ],
      rows,
    );
    expect(rows.map(sel.accessor)).toEqual([10, EMPTY_FILTER_VALUE, EMPTY_FILTER_VALUE]);
    expect(rows.map(rng.accessor)).toEqual([10, undefined, undefined]);
    expect(rows.map(txt.accessor)).toEqual(["Austin", undefined, "Boston"]);
  });
});

describe("deriveFilterDescriptors + useTableFilters", () => {
  const columns: ColumnDef<Row>[] = [
    col({ id: "city", kind: "text", value: r => r.city }),
    col({ id: "dist", kind: "number", value: r => r.distance }),
  ];
  const descriptors = deriveFilterDescriptors(columns, rows);

  it("(empty) select option matches only null rows", () => {
    const { result } = renderHook(() => useTableFilters(rows, descriptors));
    expect(result.current.distinctValuesByKey.city).toEqual(["Austin", EMPTY_FILTER_VALUE, "Boston"]);
    act(() => result.current.setFilter("city", { type: "select", values: [EMPTY_FILTER_VALUE] }));
    expect(result.current.filteredRows.map(r => r.id)).toEqual(["W2"]);
  });

  it("a real cell whose text is literally '(empty)' is its own option and never matches the empty option", () => {
    const withLiteral: Row[] = [...rows, { id: "W4", city: "(empty)", distance: 1, status: "open" }];
    const d = deriveFilterDescriptors(columns, withLiteral);
    const { result } = renderHook(() => useTableFilters(withLiteral, d));
    expect(result.current.distinctValuesByKey.city).toEqual(["Austin", EMPTY_FILTER_VALUE, "Boston", "(empty)"]);
    act(() => result.current.setFilter("city", { type: "select", values: [EMPTY_FILTER_VALUE] }));
    expect(result.current.filteredRows.map(r => r.id)).toEqual(["W2"]);
    act(() => result.current.setFilter("city", { type: "select", values: ["(empty)"] }));
    expect(result.current.filteredRows.map(r => r.id)).toEqual(["W4"]);
  });

  it("an active range excludes null and NaN rows; no range keeps them", () => {
    const { result } = renderHook(() => useTableFilters(rows, descriptors));
    expect(result.current.filteredRows).toHaveLength(3);
    act(() => result.current.setFilter("dist", { type: "number", min: 0 }));
    expect(result.current.filteredRows.map(r => r.id)).toEqual(["W1"]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter studio exec vitest run src/__tests__/deriveFilterDescriptors.test.ts`
Expected: FAIL — `Error: Failed to resolve import "@/components/data-table/deriveFilterDescriptors" from "src/__tests__/deriveFilterDescriptors.test.ts". Does the file exist?`

- [ ] **Step 3: Add the empty-option token to `useTableFilters.ts`**

In `artifacts/studio/src/lib/useTableFilters.ts`, replace:

```ts
export type ColumnFilterType = "text" | "select" | "number";
```

with:

```ts
export type ColumnFilterType = "text" | "select" | "number";

/** SCU-2.P1 (B2.2) — the internal select-option value an accessor returns for an
 * empty (null/NaN) cell. NUL-prefixed, so no real cell text can equal it (a raw
 * "(empty)" string stays its own option). FilterMenu displays it as
 * `EMPTY_FILTER_LABEL` and uses `__empty__` in its option testids. */
export const EMPTY_FILTER_VALUE = "\u0000empty";
export const EMPTY_FILTER_LABEL = "(empty)";
```

- [ ] **Step 3b: Write the contract types**

Create `artifacts/studio/src/components/data-table/types.ts`:

```ts
// SCU-2.P1 (spec B2.1) — the public contract of the shared Workspace table
// shell. P3/P4 adapters are written against these types only; DataTable.tsx
// is the single renderer. Kept in its own file so an adapter module can
// import the types without importing React components.

import type { ReactNode } from "react";

/** Drives alignment (number → centred) and filter auto-derivation (B2.2). */
export type ColumnKind = "text" | "number" | "enum";

/** Explicit filter override. "range" maps to `useTableFilters`' "number". */
export type ColumnFilterKind = "text" | "select" | "range";

/** Raw value used for filtering and client export — never display text. */
export type CellValue = string | number | null;

/** What an adapter passes as `ctx`. `readOnly` and `demandEditable` are REQUIRED so an
 * adapter can never silently drop D2 history protection or the Brazil demand lock;
 * the row predicates default to "never" (no highlighting). */
export interface DataTableContext<T> {
  readOnly: boolean;
  demandEditable: boolean;
  isOverridden?: (row: T) => boolean;
  isChanged?: (row: T) => boolean;
  isAdded?: (row: T) => boolean;
}

/** Passed to every `cell` and `rowClassName` call (the adapter's ctx with predicates filled). */
export interface CellContext<T> {
  /** History browsing: every editable cell in base, added and JADE rows is disabled (D2). */
  readOnly: boolean;
  /** Brazil base demand lock (`!demandEditable` applies to base demand only). */
  demandEditable: boolean;
  isOverridden: (row: T) => boolean;
  isChanged: (row: T) => boolean;
  isAdded: (row: T) => boolean;
}

export interface ColumnDef<T> {
  /** Stable id. Also the filter descriptor key, so FilterMenu emits
   * `filter-control-{id}`, `input-filter-{id}`, `checkbox-filter-{id}-{value}`. */
  id: string;
  header: ReactNode;
  /** FilterMenu label. Defaults to `header` when it is a string, else `id`. */
  filterLabel?: string;
  kind: ColumnKind;
  cell: (row: T, ctx: CellContext<T>) => ReactNode;
  value: (row: T) => CellValue;
  /** Overrides auto-derivation; `false` = this column is not filterable. */
  filter?: false | ColumnFilterKind;
  /** data-testid on this column's <td> for `row`. */
  cellTestId?: (row: T) => string;
  /** data-testid on this column's <th>. */
  headerTestId?: string;
  /** Extra classes on the <td> (e.g. "font-mono text-xs"); alignment and padding are the shell's. */
  cellClassName?: string;
  /** Filter-only column: never rendered (no <th>/<td>), still gets a filter descriptor
   * (e.g. CapabilityMatrix `state`, `CapabilityMatrixTab.tsx:65`). */
  hidden?: boolean;
  /** When this value changes, ONLY this column's active filter is cleared (e.g. the
   * JADE `band` filter when bands or the unit change, `JadeAssignmentsTab.tsx:277-280`). */
  filterResetKey?: string | number;
}

/** Explicit literal testid mapping — nothing is auto-prefixed. Omitted = no attribute. */
export interface DataTableTestIds<T> {
  /** Outer wrapper <div> that holds toolbar + table(s) + pager. */
  root?: string;
  toolbar?: string;
  /** The <table> element (single-table mode; sections use `DataTableSection.tableTestId`). */
  table?: string;
  /** The scroll wrapper <div> around the <table> (single-table mode; sections use `scrollTestId`). */
  scroll?: string;
  /** Always-visible "{filtered} of {total}" counter in the toolbar (e.g. `text-jadeassignments-count`). Omitted = no counter. */
  count?: string;
  row?: (row: T) => string;
  pager?: string;
  pagerPrev?: string;
  pagerNext?: string;
  pageIndicator?: string;
  /** Defaults to FilterMenu's own `button-filter-menu-trigger`. */
  filterTrigger?: string;
  /** Element rendered when `rows` is empty. */
  empty?: string;
  /** The single full-width row rendered when the filter matches nothing. */
  noMatch?: string;
}

export interface DataTableToolbar {
  upload?: ReactNode;
  download?: ReactNode;
  add?: ReactNode;
  extra?: ReactNode;
  /** Where `download` renders: "left" (default, in slot order) or "right" (last,
   *  after the count and the filter trigger — output tables, user decision 2026-10-17). */
  downloadAlign?: "left" | "right";
}

/** Base + added rows rendered as titled groups under ONE toolbar, filter menu and pager. */
export interface DataTableSection<T> {
  id: string;
  title?: ReactNode;
  /** data-testid on the section wrapper <div>. */
  testId?: string;
  /** data-testid on this section's <table>. */
  tableTestId?: string;
  /** data-testid on this section's scroll wrapper <div>. */
  scrollTestId?: string;
  /** Classes for this section's scroll wrapper (base and added scroll independently today). */
  scrollClassName?: string;
  /** Row testid for this section; overrides `testIds.row`. */
  rowTestId?: (row: T) => string;
  /** A row renders in the FIRST section whose `includes` is true; a row matching none is not rendered. */
  includes: (row: T) => boolean;
  /** Section-specific columns (e.g. added rows carry a delete column). Defaults to the table's `columns`. */
  columns?: ColumnDef<T>[];
  /** Rendered after this section's table (e.g. an inline add-row form + its error text). Always rendered. */
  footer?: ReactNode;
  /** Rendered in place of this section's table when NO row in `rows` belongs to it. */
  emptyState?: ReactNode;
}

/** Focus jump (`DistancesTab.tsx:459-479`, `JadeDistancesTab.tsx:441-505`). A new
 * `token` clears every filter, moves to the page holding the first matching row
 * and scrolls that row into view. */
export interface DataTableFocus<T> {
  token: string | number;
  matches: (row: T) => boolean;
}

export interface DataTableProps<T> {
  /** Already-effective rows (base ⊕ saved overrides ⊕ current edits ⊕ added), base rows first. */
  rows: T[];
  /** Unique per row; composite keys allowed (e.g. `${fromId}|${toId}`). */
  rowKey: (row: T) => string;
  /** May be rebuilt each render; DataTable/FilterMenu must not key effects on this array's identity. */
  columns: ColumnDef<T>[];
  testIds?: DataTableTestIds<T>;
  rowClassName?: (row: T, ctx: CellContext<T>) => string | undefined;
  /** Required. Output tables pass `{ readOnly: true, demandEditable: false }` or the live flags. */
  ctx: DataTableContext<T>;
  toolbar?: DataTableToolbar;
  /** Rendered INSTEAD of table(s)/pager when `rows` is empty (toolbar slots still render).
   * With `sections` and no top-level emptyState, each section's own emptyState renders instead. */
  emptyState?: ReactNode;
  /** Text of the full-width row shown when the filter matches nothing. Default "No rows match the current filter." */
  noMatchText?: ReactNode;
  sections?: DataTableSection<T>[];
  focus?: DataTableFocus<T> | null;
  /** Classes for the scroll wrapper around the table (single-table mode), e.g. "max-h-[55vh] overflow-y-auto". */
  scrollClassName?: string;
  /** Rendered inside the root after the pager (e.g. CostSummary's bands note). */
  footer?: ReactNode;
}
```

- [ ] **Step 4: Write the derivation**

Create `artifacts/studio/src/components/data-table/deriveFilterDescriptors.ts`:

```ts
// SCU-2.P1 (spec B2.2 "Filter") — FilterMenu descriptors generated from a
// DataTable's columns. Precedence: explicit `filter` → kind number = range →
// kind enum = select → kind text = select when ≤ 20 distinct non-null values,
// else text. Filtering reads `value()`, never display text. null/NaN match
// only the "(empty)" select option — an internal token, `EMPTY_FILTER_VALUE`,
// that no real value can equal — and are excluded from ranges.

import { EMPTY_FILTER_VALUE } from "@/lib/useTableFilters";
import type { ColumnFilterDescriptor, ColumnFilterType } from "@/lib/useTableFilters";
import type { CellValue, ColumnDef } from "./types";

export const FILTER_ROW_THRESHOLD = 10;
export const SELECT_DISTINCT_MAX = 20;

function isEmpty(v: CellValue): boolean {
  return v === null || (typeof v === "number" && Number.isNaN(v));
}

function resolveType<T>(column: ColumnDef<T>, rows: T[]): ColumnFilterType {
  if (column.filter === "range") return "number";
  if (column.filter === "select" || column.filter === "text") return column.filter;
  if (column.kind === "number") return "number";
  if (column.kind === "enum") return "select";
  const distinct = new Set<string>();
  for (const row of rows) {
    const v = column.value(row);
    if (isEmpty(v)) continue;
    distinct.add(String(v));
    if (distinct.size > SELECT_DISTINCT_MAX) return "text";
  }
  return "select";
}

export function deriveFilterDescriptors<T>(columns: ColumnDef<T>[], rows: T[]): ColumnFilterDescriptor<T>[] {
  return columns
    .filter(c => c.filter !== false)
    .map(c => {
      const type = resolveType(c, rows);
      const label = c.filterLabel ?? (typeof c.header === "string" ? c.header : c.id);
      const accessor = (row: T): string | number | undefined => {
        const v = c.value(row);
        if (isEmpty(v)) return type === "select" ? EMPTY_FILTER_VALUE : undefined;
        return v as string | number;
      };
      return { key: c.id, label, type, accessor };
    });
}
```

- [ ] **Step 5: Run it to verify it passes**

Run: `pnpm --filter studio exec vitest run src/__tests__/deriveFilterDescriptors.test.ts`
Expected: PASS — 11 tests (measured at plan time).

- [ ] **Step 6: e2e sweep**

New files plus two unused constants; no rendered UI changes. Run `git diff --name-only HEAD -- artifacts/studio/e2e` → empty. Record `e2e: n/a (no UI change)`.

- [ ] **Step 7: Gate**

Run each separately:
1. `cnt=$(ps aux | grep "[v]itest" | grep -v "zsh -c" | wc -l | tr -d ' '); [ "$cnt" = "0" ]`
2. `pnpm run typecheck`
3. `pnpm --filter studio typecheck:e2e`
4. `DATABASE_URL="postgresql://shubhamkr@localhost:5432/nos_dev" pnpm --filter api-server test`
5. `pnpm --filter studio test`
6. `(cd artifacts/api-server/src/solver && python3 -m pytest tests/ -x)`

Expected: every command exits 0.

- [ ] **Step 8: Changelog**

Append to the bottom of `docs/CHANGELOG-implementation.md`:

```markdown

### SCU-2.P1.2 — DataTable contract types + filter auto-derivation

- `components/data-table/types.ts` (the P3/P4 adapter contract; `ctx` required) and `deriveFilterDescriptors.ts` (explicit → number=range → enum=select → text ≤ 20 distinct = select else text; null/NaN → the internal `EMPTY_FILTER_VALUE` option, excluded from ranges). `useTableFilters.ts` gains `EMPTY_FILTER_VALUE` / `EMPTY_FILTER_LABEL`.
- Deviations 1 (additive props), 4 (`CellContext<T>`), 5 (required `ctx`), 6 (`hidden` filter-only column), 7 (empty token).
- Gate: studio <N passed>, api-server <N passed>, pytest <N passed>. e2e: n/a (no UI change).
```

- [ ] **Step 9: Commit**

```bash
git add artifacts/studio/src/components/data-table/types.ts artifacts/studio/src/components/data-table/deriveFilterDescriptors.ts artifacts/studio/src/__tests__/deriveFilterDescriptors.test.ts
```

```bash
[ "$(git rev-parse --abbrev-ref HEAD)" != "main" ] || exit 1
```

```bash
git commit artifacts/studio/src/lib/useTableFilters.ts artifacts/studio/src/components/data-table/types.ts artifacts/studio/src/components/data-table/deriveFilterDescriptors.ts artifacts/studio/src/__tests__/deriveFilterDescriptors.test.ts docs/CHANGELOG-implementation.md -m "[SCU-2.P1.2] add DataTable contract types and filter derivation" -m "Deviations 1, 4, 5, 6, 7: additive testId/column fields, generic CellContext, required ctx, filter-only hidden columns, internal empty-option token." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task SCU-2.P1.3: `usePagedRows` + `TablePager` (B2.2 "Paging")

**Owner role:** frontend-engineer. **Spec:** B2.2 "Pipeline", "Paging" (rev 4 reset rule). **Deviations:** 3, 9.

**Files:**
- Create: `artifacts/studio/src/components/data-table/usePagedRows.ts`
- Create: `artifacts/studio/src/components/data-table/TablePager.tsx`
- Test: `artifacts/studio/src/__tests__/usePagedRows.test.tsx`
- Modify: `docs/CHANGELOG-implementation.md` (append `### SCU-2.P1.3`)

**Interfaces:**
- Consumes: `Button` from `@/components/ui/button` (existing); `FilterState`, `FilterValue` types from `@/lib/useTableFilters`. Markup and classes copy `DistancesTab.tsx:203-246`'s local `Pager` so migrated tables look the same.
- Produces: `PAGE_SIZE = 50`; `PagedRows<T>`; `pageResetKey<T>(rows: T[], rowKey: (row: T) => string, filterState: FilterState): string`; `usePagedRows<T>(rows: T[], resetKey: string): PagedRows<T>` (no page-size parameter); `TablePager(props: TablePagerProps)`; `TablePagerTestIds { pager?, prev?, next?, indicator? }`. The four local pagers (`DistancesTab.tsx:330`, `JadeDistancesTab.tsx:335`, `DeliveryCostsTab.tsx:59`, `JadeAssignmentsTab.tsx:166`) are **not** touched in P1; P3/P4 replace them when they migrate those tables.

- [ ] **Step 0: Invoke the simplicity skills**

Skill tool: `andrej-karpathy-skills:karpathy-guidelines`, then `ponytail:ponytail`. Record in the report that both ran.

- [ ] **Step 1: Write the failing test**

Create `artifacts/studio/src/__tests__/usePagedRows.test.tsx`:

```tsx
import { describe, expect, it, vi } from "vitest";
import { act, render, renderHook, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PAGE_SIZE, pageResetKey, usePagedRows } from "@/components/data-table/usePagedRows";
import { TablePager } from "@/components/data-table/TablePager";

const range = (n: number) => Array.from({ length: n }, (_, i) => i);

describe("usePagedRows", () => {
  it("pins the spec page size", () => {
    expect(PAGE_SIZE).toBe(50);
  });

  it("50 rows: one page, no pager; 51 rows: two pages, pager", () => {
    const a = renderHook(() => usePagedRows(range(50), "k")).result.current;
    expect([a.pageCount, a.pageRows.length, a.showPager]).toEqual([1, 50, false]);
    const b = renderHook(() => usePagedRows(range(51), "k")).result.current;
    expect([b.pageCount, b.pageRows.length, b.showPager]).toEqual([2, 50, true]);
  });

  it("empty list has one empty page", () => {
    const r = renderHook(() => usePagedRows([], "")).result.current;
    expect([r.page, r.pageCount, r.pageRows]).toEqual([1, 1, []]);
  });

  it("setPage slices the requested page", () => {
    const { result } = renderHook(() => usePagedRows(range(120), "k"));
    act(() => result.current.setPage(3));
    expect(result.current.page).toBe(3);
    expect(result.current.pageRows).toEqual(range(120).slice(100));
  });

  it("a page beyond the end clamps to the last page", () => {
    const { result } = renderHook(() => usePagedRows(range(120), "k"));
    act(() => result.current.setPage(99));
    expect(result.current.page).toBe(3);
  });

  it("shrinking rows under the same key clamps down instead of stranding", () => {
    const { result, rerender } = renderHook(({ rows }) => usePagedRows(rows, "k"), {
      initialProps: { rows: range(120) },
    });
    act(() => result.current.setPage(3));
    rerender({ rows: range(60) });
    expect(result.current.page).toBe(2);
  });

  it("a resetKey change returns to page 1; same key (cell edit) keeps the page", () => {
    const { result, rerender } = renderHook(({ rows, k }) => usePagedRows(rows, k), {
      initialProps: { rows: range(120), k: "a" },
    });
    act(() => result.current.setPage(2));
    rerender({ rows: range(120).map(x => x), k: "a" });
    expect(result.current.page).toBe(2);
    rerender({ rows: range(120), k: "b" });
    expect(result.current.page).toBe(1);
  });

  it("setPage(page, forResetKey) survives the key change it anticipates", () => {
    const { result, rerender } = renderHook(({ k }) => usePagedRows(range(120), k), {
      initialProps: { k: "filtered" },
    });
    act(() => result.current.setPage(3, "all"));
    rerender({ k: "all" });
    expect(result.current.page).toBe(3);
  });
});

describe("pageResetKey", () => {
  const key = (r: { id: string }) => r.id;
  const a = [{ id: "a" }, { id: "b" }, { id: "c" }];

  it("is order-insensitive in rows", () => {
    expect(pageResetKey([...a].reverse(), key, {})).toBe(pageResetKey(a, key, {}));
  });

  it("changes when a row key is added or removed", () => {
    expect(pageResetKey([...a, { id: "d" }], key, {})).not.toBe(pageResetKey(a, key, {}));
    expect(pageResetKey(a.slice(1), key, {})).not.toBe(pageResetKey(a, key, {}));
  });

  it("is insensitive to filter-state key order and select-value order", () => {
    const one = pageResetKey(a, key, {
      city: { type: "select", values: ["x", "y"] },
      dist: { type: "number", min: 1 },
    });
    const two = pageResetKey(a, key, {
      dist: { type: "number", min: 1, max: undefined },
      city: { type: "select", values: ["y", "x"] },
    });
    expect(two).toBe(one);
  });

  it("changes when any filter value changes", () => {
    const base = pageResetKey(a, key, { t: { type: "text", value: "a" } });
    expect(pageResetKey(a, key, { t: { type: "text", value: "ab" } })).not.toBe(base);
    expect(pageResetKey(a, key, {})).not.toBe(base);
  });
});

describe("TablePager", () => {
  it("renders the literal testids and Page X of Y", () => {
    render(
      <TablePager
        page={2}
        pageCount={3}
        onPageChange={() => {}}
        testIds={{ pager: "p", prev: "button-x-prev", next: "button-x-next", indicator: "x-page-indicator" }}
      />,
    );
    expect(screen.getByTestId("x-page-indicator")).toHaveTextContent("Page 2 of 3");
    expect(screen.getByTestId("p")).toContainElement(screen.getByTestId("button-x-prev"));
  });

  it("omitted testids emit no data-testid attribute", () => {
    const { container } = render(<TablePager page={1} pageCount={1} onPageChange={() => {}} />);
    expect(container.querySelectorAll("[data-testid]")).toHaveLength(0);
  });

  it("disables Prev on the first page and Next on the last; clicks report the target page", async () => {
    const onPageChange = vi.fn();
    const user = userEvent.setup();
    const { rerender } = render(
      <TablePager page={1} pageCount={2} onPageChange={onPageChange} testIds={{ prev: "prev", next: "next" }} />,
    );
    expect(screen.getByTestId("prev")).toBeDisabled();
    await user.click(screen.getByTestId("next"));
    expect(onPageChange).toHaveBeenLastCalledWith(2);
    rerender(<TablePager page={2} pageCount={2} onPageChange={onPageChange} testIds={{ prev: "prev", next: "next" }} />);
    expect(screen.getByTestId("next")).toBeDisabled();
    await user.click(screen.getByTestId("prev"));
    expect(onPageChange).toHaveBeenLastCalledWith(1);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter studio exec vitest run src/__tests__/usePagedRows.test.tsx`
Expected: FAIL — `Error: Failed to resolve import "@/components/data-table/usePagedRows" from "src/__tests__/usePagedRows.test.tsx". Does the file exist?`

- [ ] **Step 3: Write the hook**

Create `artifacts/studio/src/components/data-table/usePagedRows.ts`:

```ts
// SCU-2.P1 (spec B2.2 "Paging") — replaces the four local `PAGE_SIZE = 50`
// pagers (DistancesTab, JadeDistancesTab, DeliveryCostsTab,
// JadeAssignmentsTab). Pure client paging over already-filtered rows. The
// page size is fixed at 50 by the spec; there is deliberately no override.
//
// Reset rule (B2.2): a change of `resetKey` returns to page 1. DataTable
// builds it with `pageResetKey`: the canonical filter state + the SORTED key
// set of ALL effective rows (not just the filtered ones). So any filter
// change, and any add/delete — even of a row the filter hides — resets;
// editing a cell (same keys) or reordering rows does not, even when the edit
// moves a row in or out of the filter (the page then only clamps).
// A page beyond the end clamps to the last page (derived, no effect).
// `setPage(page, forResetKey)` pre-claims the key the table is ABOUT to have
// (a focus jump clears the filters in the same tick), so the reset rule
// adopts that page instead of undoing the jump.

import { useState } from "react";
import type { FilterState, FilterValue } from "@/lib/useTableFilters";

export const PAGE_SIZE = 50;

export interface PagedRows<T> {
  /** 1-based, always within [1, pageCount]. */
  page: number;
  /** ≥ 1 (an empty list has one empty page). */
  pageCount: number;
  pageRows: T[];
  /** Spec: pager rendered only when filtered rows > 50. */
  showPager: boolean;
  setPage: (page: number, forResetKey?: string) => void;
}

const SEP = "\u0000";

function canonicalFilterValue(v: FilterValue): unknown {
  if (v.type === "select") return { type: "select", values: [...v.values].sort() };
  if (v.type === "number") return { type: "number", min: v.min ?? null, max: v.max ?? null };
  return { type: "text", value: v.value };
}

/** Order-insensitive identity of (filter state, effective row-key set). */
export function pageResetKey<T>(rows: T[], rowKey: (row: T) => string, filterState: FilterState): string {
  const filters = Object.keys(filterState)
    .sort()
    .map(k => [k, canonicalFilterValue(filterState[k])]);
  return JSON.stringify(filters) + SEP + rows.map(rowKey).sort().join(SEP);
}

export function usePagedRows<T>(rows: T[], resetKey: string): PagedRows<T> {
  const [state, setState] = useState<{ page: number; key: string; claim?: string }>({ page: 1, key: resetKey });
  // Render-phase state adjustment (React-sanctioned) — no effect, no flash of the old page.
  if (state.key !== resetKey) {
    setState(state.claim === resetKey ? { page: state.page, key: resetKey } : { page: 1, key: resetKey });
  }
  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const raw = state.key === resetKey || state.claim === resetKey ? state.page : 1;
  const page = Math.min(Math.max(1, raw), pageCount);
  const pageRows = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const setPage = (next: number, forResetKey?: string) =>
    setState(prev => ({ page: Math.max(1, Math.floor(next)), key: prev.key, claim: forResetKey }));
  return { page, pageCount, pageRows, showPager: rows.length > PAGE_SIZE, setPage };
}
```

- [ ] **Step 4: Write the pager**

Create `artifacts/studio/src/components/data-table/TablePager.tsx`:

```tsx
// SCU-2.P1 (spec B2.2 "Paging") — Prev / "Page X of Y" / Next. Markup and
// classes are DistancesTab's `Pager` (DistancesTab.tsx:203-243) so a migrated
// table looks the same; testids are passed literally per table.

import { Button } from "@/components/ui/button";

export interface TablePagerTestIds {
  pager?: string;
  prev?: string;
  next?: string;
  indicator?: string;
}

export interface TablePagerProps {
  page: number;
  pageCount: number;
  onPageChange: (page: number) => void;
  testIds?: TablePagerTestIds;
}

export function TablePager({ page, pageCount, onPageChange, testIds = {} }: TablePagerProps) {
  return (
    <div className="flex items-center justify-end gap-2 mt-1 text-xs" data-testid={testIds.pager}>
      <Button
        size="sm"
        variant="outline"
        className="h-6 px-2 text-xs"
        disabled={page <= 1}
        onClick={() => onPageChange(page - 1)}
        data-testid={testIds.prev}
      >
        Prev
      </Button>
      <span className="font-mono text-[11px] text-muted-foreground" data-testid={testIds.indicator}>
        Page {page} of {pageCount}
      </span>
      <Button
        size="sm"
        variant="outline"
        className="h-6 px-2 text-xs"
        disabled={page >= pageCount}
        onClick={() => onPageChange(page + 1)}
        data-testid={testIds.next}
      >
        Next
      </Button>
    </div>
  );
}
```

- [ ] **Step 5: Run it to verify it passes**

Run: `pnpm --filter studio exec vitest run src/__tests__/usePagedRows.test.tsx`
Expected: PASS — 15 tests (8 hook, 4 `pageResetKey`, 3 pager; measured at plan time). The DataTable-level reset cases (filtered-out/-in add and delete, filter-column edit, reorder) are in P1.4.

- [ ] **Step 6: e2e sweep**

New files only. `git diff --name-only HEAD -- artifacts/studio/e2e` → empty. Record `e2e: n/a (no UI change)`.

- [ ] **Step 7: Gate**

Run each separately:
1. `cnt=$(ps aux | grep "[v]itest" | grep -v "zsh -c" | wc -l | tr -d ' '); [ "$cnt" = "0" ]`
2. `pnpm run typecheck`
3. `pnpm --filter studio typecheck:e2e`
4. `DATABASE_URL="postgresql://shubhamkr@localhost:5432/nos_dev" pnpm --filter api-server test`
5. `pnpm --filter studio test`
6. `(cd artifacts/api-server/src/solver && python3 -m pytest tests/ -x)`

Expected: every command exits 0.

- [ ] **Step 8: Changelog**

Append to the bottom of `docs/CHANGELOG-implementation.md`:

```markdown

### SCU-2.P1.3 — usePagedRows + TablePager

- `PAGE_SIZE = 50` (fixed, no override), pager only when rows > 50; derived clamp; reset on resetKey change; `setPage(page, forResetKey)` claim for focus jumps. `pageResetKey` = canonical filter state + sorted key set of ALL effective rows. `TablePager` = DistancesTab's Pager markup with literal testids.
- Deviations 3 (reset key per spec rev 4), 9 (no page-size override).
- Gate: studio <N passed>, api-server <N passed>, pytest <N passed>. e2e: n/a (no UI change).
```

- [ ] **Step 9: Commit**

```bash
git add artifacts/studio/src/components/data-table/usePagedRows.ts artifacts/studio/src/components/data-table/TablePager.tsx artifacts/studio/src/__tests__/usePagedRows.test.tsx
```

```bash
[ "$(git rev-parse --abbrev-ref HEAD)" != "main" ] || exit 1
```

```bash
git commit artifacts/studio/src/components/data-table/usePagedRows.ts artifacts/studio/src/components/data-table/TablePager.tsx artifacts/studio/src/__tests__/usePagedRows.test.tsx docs/CHANGELOG-implementation.md -m "[SCU-2.P1.3] add usePagedRows and TablePager" -m "Deviations 3, 9: reset key = canonical filters + sorted all-row key set; page size fixed at 50." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task SCU-2.P1.4: `DataTable` shell + `FilterMenu` trigger testid and empty option (B2.1 rendering, B2.2 pipeline)

**Owner role:** frontend-engineer. **Spec:** B2.1 (props, rendering, `readOnly`), B2.2 rev 4 (pipeline, reset rule, filter, paging, focus jump). **Deviations:** 1, 2, 3, 5, 7, 8.

**Files:**
- Modify: `artifacts/studio/src/components/tables/FilterMenu.tsx:21` (import), `:23-36` (props interface), `:49` (signature), `:56` (trigger `data-testid`), `:103-125` (select-option rendering)
- Test: `artifacts/studio/src/components/tables/FilterMenu.test.tsx` (`:5` import line; append after the last line, `:116`, which closes the existing `describe`)
- Create: `artifacts/studio/src/components/data-table/DataTable.tsx`
- Test: `artifacts/studio/src/__tests__/DataTable.test.tsx`
- Modify: `docs/CHANGELOG-implementation.md` (append `### SCU-2.P1.4`)

**Interfaces:**
- Consumes: `types.ts` + `deriveFilterDescriptors` (P1.2); `EMPTY_FILTER_VALUE`, `EMPTY_FILTER_LABEL` (P1.2, `@/lib/useTableFilters`); `usePagedRows`, `pageResetKey`, `PAGE_SIZE`, `TablePager` (P1.3); `Table, TableHeader, TableBody, TableRow, TableHead, TableCell` from `@/components/ui/table` (existing; `TableHead` default classes `h-10 px-2 text-left …`, `TableCell` `p-2 …` — the shell overrides padding/height via `cn`, which is `twMerge(clsx(…))`, `lib/utils.ts:4-6`); `useTableFilters` (existing); `cn`.
- Produces: `DataTable<T>(props: DataTableProps<T>)`; `FilterMenuProps<T>.triggerTestId?: string` (default `"button-filter-menu-trigger"`); FilterMenu renders an option whose value is `EMPTY_FILTER_VALUE` as "(empty)" with testids `option-filter-{key}-__empty__` / `checkbox-filter-{key}-__empty__`.

- [ ] **Step 0: Invoke the simplicity skills**

Skill tool: `andrej-karpathy-skills:karpathy-guidelines`, then `ponytail:ponytail`. Record in the report that both ran.

- [ ] **Step 1: Write the failing FilterMenu tests**

In `artifacts/studio/src/components/tables/FilterMenu.test.tsx`, replace the import line (`:5`):

```tsx
import { useTableFilters, type ColumnFilterDescriptor } from "@/lib/useTableFilters";
```

with:

```tsx
import { EMPTY_FILTER_VALUE, useTableFilters, type ColumnFilterDescriptor } from "@/lib/useTableFilters";
```

Then append **after** the file's last line (`:116`, the `});` that closes the existing `describe("FilterMenu", …)`) — the block below opens two new top-level `describe`s and contains no stray closing brace:

```tsx
describe("FilterMenu — triggerTestId (SCU-2.P1)", () => {
  function Mapped({ triggerTestId }: { triggerTestId?: string }) {
    const tableFilters = useTableFilters(rows, descriptors);
    return <FilterMenu descriptors={descriptors} tableFilters={tableFilters} triggerTestId={triggerTestId} />;
  }

  it("defaults the trigger testid to button-filter-menu-trigger", () => {
    render(<Mapped />);
    expect(screen.getByTestId("button-filter-menu-trigger")).toBeInTheDocument();
  });

  it("uses a mapped trigger testid when given", () => {
    render(<Mapped triggerTestId="button-filter-jade-flows-pw" />);
    expect(screen.getByTestId("button-filter-jade-flows-pw")).toBeInTheDocument();
    expect(screen.queryByTestId("button-filter-menu-trigger")).toBeNull();
  });
});

describe("FilterMenu — empty option (SCU-2.P1)", () => {
  interface E { id: string; v: string }
  const eRows: E[] = [{ id: "1", v: "a" }, { id: "2", v: EMPTY_FILTER_VALUE }];
  const eDescriptors: ColumnFilterDescriptor<E>[] = [{ key: "v", label: "V", type: "select", accessor: r => r.v }];
  function EmptyHarness() {
    const tableFilters = useTableFilters(eRows, eDescriptors);
    return (
      <div>
        <FilterMenu descriptors={eDescriptors} tableFilters={tableFilters} />
        <div data-testid="visible-rows">{tableFilters.filteredRows.map(r => r.id).join(",")}</div>
      </div>
    );
  }

  it("shows the empty token as '(empty)' with a __empty__ testid suffix, and selecting it filters", async () => {
    const user = userEvent.setup();
    render(<EmptyHarness />);
    await user.click(screen.getByTestId("button-filter-menu-trigger"));
    expect(screen.getByTestId("option-filter-v-__empty__")).toHaveTextContent("(empty)");
    await user.click(screen.getByTestId("checkbox-filter-v-__empty__"));
    expect(screen.getByTestId("visible-rows")).toHaveTextContent("2");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter studio exec vitest run src/components/tables/FilterMenu.test.tsx`
Expected: FAIL — `Tests  2 failed | 10 passed (12)`: "uses a mapped trigger testid when given" (`TestingLibraryElementError: Unable to find an element by: [data-testid="button-filter-jade-flows-pw"]`) and "shows the empty token as '(empty)' …" (`Unable to find an element by: [data-testid="option-filter-v-__empty__"]`). Measured at plan time against the unmodified `FilterMenu.tsx`.

- [ ] **Step 3: Change FilterMenu**

In `artifacts/studio/src/components/tables/FilterMenu.tsx`:

(a) Replace the type-only import line

```tsx
import type { ColumnFilterDescriptor, FilterState, FilterValue, UseTableFiltersResult } from "@/lib/useTableFilters";
```

with:

```tsx
import { EMPTY_FILTER_LABEL, EMPTY_FILTER_VALUE } from "@/lib/useTableFilters";
import type { ColumnFilterDescriptor, FilterState, FilterValue, UseTableFiltersResult } from "@/lib/useTableFilters";
```

(b) Replace:

```tsx
  /** Trigger button label. Defaults to "Filter". */
  label?: string;
}
```

with:

```tsx
  /** Trigger button label. Defaults to "Filter". */
  label?: string;
  /** Trigger testid. Defaults to `button-filter-menu-trigger` (SCU-2.P1: DataTable maps it per table). */
  triggerTestId?: string;
}
```

(c) Replace:

```tsx
export function FilterMenu<T>({ descriptors, tableFilters, label = "Filter" }: FilterMenuProps<T>) {
```

with:

```tsx
export function FilterMenu<T>({
  descriptors,
  tableFilters,
  label = "Filter",
  triggerTestId = "button-filter-menu-trigger",
}: FilterMenuProps<T>) {
```

(d) Replace (the only occurrence):

```tsx
        <Button variant="outline" size="sm" className="h-7 gap-1.5 text-xs" data-testid="button-filter-menu-trigger">
```

with:

```tsx
        <Button variant="outline" size="sm" className="h-7 gap-1.5 text-xs" data-testid={triggerTestId}>
```

(e) In the select-option `map`, replace:

```tsx
                    const stringValue = String(value);
                    const selected
```

with:

```tsx
                    const stringValue = String(value);
                    const isEmptyOption = stringValue === EMPTY_FILTER_VALUE;
                    const optionLabel = isEmptyOption ? EMPTY_FILTER_LABEL : stringValue;
                    const optionId = isEmptyOption ? "__empty__" : stringValue;
                    const selected
```

then replace ``data-testid={`option-filter-${descriptor.key}-${stringValue}`}`` with ``data-testid={`option-filter-${descriptor.key}-${optionId}`}``, ``data-testid={`checkbox-filter-${descriptor.key}-${stringValue}`}`` with ``data-testid={`checkbox-filter-${descriptor.key}-${optionId}`}``, and `<span>{stringValue}</span>` with `<span>{optionLabel}</span>`. Selection still stores `stringValue` (the token), so filtering is unchanged.

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm --filter studio exec vitest run src/components/tables/FilterMenu.test.tsx src/__tests__/ImportDialog.test.tsx`
Expected: PASS — `FilterMenu.test.tsx` 12 tests, `ImportDialog.test.tsx` 10 tests (the other FilterMenu consumer; measured at plan time).

- [ ] **Step 5: Write the failing DataTable test**

Create `artifacts/studio/src/__tests__/DataTable.test.tsx`:

```tsx
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DataTable } from "@/components/data-table/DataTable";
import type { ColumnDef, DataTableContext, DataTableFocus, DataTableProps } from "@/components/data-table/types";

interface Row {
  id: string;
  city: string;
  demand: number | null;
  added?: boolean;
}

const makeRows = (n: number, prefix = "C"): Row[] =>
  Array.from({ length: n }, (_, i) => ({ id: `${prefix}${i + 1}`, city: `City${i + 1}`, demand: (i + 1) * 10 }));

// Editable-table default; output tables would pass readOnly: true.
const CTX: DataTableContext<Row> = { readOnly: false, demandEditable: true };

const columns: ColumnDef<Row>[] = [
  { id: "id", header: "ID", kind: "text", value: r => r.id, cell: r => <span data-testid={`id-${r.id}`}>{r.id}</span>, filter: "text" },
  { id: "city", header: "City", kind: "text", value: r => r.city, cell: r => r.city, headerTestId: "head-city" },
  {
    id: "demand",
    header: "Demand",
    kind: "number",
    value: r => r.demand,
    cell: r => r.demand,
    cellTestId: r => `cell-demand-${r.id}`,
    cellClassName: "font-mono",
  },
  { id: "region", header: "Region", kind: "enum", value: () => "east", cell: () => "east", hidden: true },
];

function renderTable(props: Partial<DataTableProps<Row>> = {}) {
  return render(
    <DataTable<Row>
      ctx={CTX}
      rows={makeRows(3)}
      rowKey={r => r.id}
      columns={columns}
      testIds={{ row: r => `row-${r.id}` }}
      {...props}
    />,
  );
}

const headerTexts = () => screen.getAllByRole("columnheader").map(th => th.textContent);
const visibleIds = () => screen.queryAllByTestId(/^row-/).map(tr => tr.getAttribute("data-testid"));

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

describe("DataTable — markup", () => {
  it("renders real thead/th in column order and skips hidden columns", () => {
    renderTable();
    expect(headerTexts()).toEqual(["ID", "City", "Demand"]);
    expect(document.querySelector("table thead tr th")).not.toBeNull();
    expect(screen.getByRole("table")).toHaveClass("table-auto");
  });

  it("centre-aligns kind:number header and cells only; applies cellClassName", () => {
    renderTable();
    expect(screen.getByText("Demand")).toHaveClass("text-center");
    expect(screen.getByText("City")).not.toHaveClass("text-center");
    expect(screen.getByTestId("cell-demand-C1")).toHaveClass("text-center", "font-mono", "px-3", "py-1.5");
    expect(screen.getByText("City")).toHaveClass("whitespace-nowrap");
  });

  it("puts cell() output directly inside the <td> — no wrapper element", () => {
    renderTable();
    const td = screen.getByTestId("id-C1").parentElement!;
    expect(td.tagName).toBe("TD");
  });

  it("emits exactly the mapped testids and nothing else", () => {
    const { container } = render(
      <DataTable<Row>
      ctx={CTX}
        rows={makeRows(2)}
        rowKey={r => r.id}
        columns={[{ id: "city", header: "City", kind: "text", value: r => r.city, cell: r => r.city }]}
      />,
    );
    expect(container.querySelectorAll("[data-testid]")).toHaveLength(0);
  });

  it("maps root/toolbar/scroll/table/row/header/cell testids literally", () => {
    renderTable({
      testIds: { root: "t-root", toolbar: "t-toolbar", scroll: "t-scroll", table: "t-table", row: r => `row-${r.id}` },
    });
    const root = screen.getByTestId("t-root");
    expect(root).toContainElement(screen.getByTestId("t-toolbar"));
    expect(screen.getByTestId("t-scroll")).toContainElement(screen.getByTestId("t-table"));
    expect(screen.getByTestId("t-table").tagName).toBe("TABLE");
    expect(screen.getByTestId("row-C2").tagName).toBe("TR");
    expect(screen.getByTestId("head-city").tagName).toBe("TH");
    expect(screen.getByTestId("cell-demand-C3")).toHaveTextContent("30");
  });

  it("passes ctx (with defaults) to cell and rowClassName", () => {
    const seen: unknown[] = [];
    renderTable({
      ctx: { readOnly: true, demandEditable: true, isChanged: r => r.id === "C2" },
      rowClassName: (r, ctx) => (ctx.isChanged(r) ? "bg-amber-50" : undefined),
      columns: [
        {
          id: "x",
          header: "X",
          kind: "text",
          value: r => r.id,
          cell: (r, ctx) => {
            seen.push([ctx.readOnly, ctx.demandEditable, ctx.isAdded(r), ctx.isOverridden(r)]);
            return r.id;
          },
        },
      ],
    });
    expect(screen.getByTestId("row-C2")).toHaveClass("bg-amber-50");
    expect(screen.getByTestId("row-C1")).not.toHaveClass("bg-amber-50");
    expect(seen[0]).toEqual([true, true, false, false]);
  });
});

describe("DataTable — ctx is required (D2 safety)", () => {
  it("omitting ctx is a compile error, so an adapter cannot silently default readOnly to false", () => {
    const element = (
      // @ts-expect-error — `ctx` is required: readOnly and demandEditable must be passed explicitly.
      <DataTable<Row> rows={[]} rowKey={r => r.id} columns={columns} />
    );
    expect(element).toBeTruthy(); // not rendered; the assertion is the @ts-expect-error under `pnpm run typecheck`
  });

  it("an adapter's readOnly reaches every cell", () => {
    const seen: boolean[] = [];
    render(
      <DataTable<Row>
        ctx={{ readOnly: true, demandEditable: false }}
        rows={makeRows(3)}
        rowKey={r => r.id}
        columns={[{ id: "x", header: "X", kind: "text", value: r => r.id, cell: (_r, ctx) => (seen.push(ctx.readOnly && !ctx.demandEditable), null) }]}
      />,
    );
    expect(seen).toEqual([true, true, true]);
  });
});

describe("DataTable — filter", () => {
  it("no filter menu at 10 rows; one at 11 with the default trigger testid", () => {
    const { unmount } = renderTable({ rows: makeRows(10) });
    expect(screen.queryByTestId("button-filter-menu-trigger")).toBeNull();
    unmount();
    renderTable({ rows: makeRows(11) });
    expect(screen.getAllByTestId("button-filter-menu-trigger")).toHaveLength(1);
  });

  it("filterTrigger maps the trigger testid", () => {
    renderTable({ rows: makeRows(11), testIds: { filterTrigger: "button-filter-pw" } });
    expect(screen.getByTestId("button-filter-pw")).toBeInTheDocument();
  });

  it("descriptor ids are column ids and filtering reads value(); a hidden column is still filterable", async () => {
    const user = userEvent.setup();
    renderTable({ rows: makeRows(12) });
    await user.click(screen.getByTestId("button-filter-menu-trigger"));
    const pop = screen.getByTestId("filter-menu-popover");
    expect(within(pop).getByTestId("filter-control-id")).toBeInTheDocument();
    expect(within(pop).getByTestId("select-filter-city")).toBeInTheDocument(); // text, 12 distinct ≤ 20 → select
    expect(within(pop).getByTestId("input-filter-demand-min")).toBeInTheDocument(); // number → range
    expect(within(pop).getByTestId("filter-control-region")).toBeInTheDocument(); // hidden column
    await user.type(within(pop).getByTestId("input-filter-demand-min"), "100");
    expect(visibleIds()).toEqual(["row-C10", "row-C11", "row-C12"]);
  });

  it("a filter matching nothing renders one full-width no-match row", async () => {
    const user = userEvent.setup();
    renderTable({ rows: makeRows(12), testIds: { row: r => `row-${r.id}`, noMatch: "t-nomatch" } });
    await user.click(screen.getByTestId("button-filter-menu-trigger"));
    await user.type(screen.getByTestId("input-filter-id"), "zzz");
    expect(visibleIds()).toEqual([]);
    const cell = screen.getByTestId("t-nomatch");
    expect(cell).toHaveTextContent("No rows match the current filter.");
    expect(cell).toHaveAttribute("colspan", "3");
  });

  it("filterResetKey change clears only that column's filter", async () => {
    const user = userEvent.setup();
    const cols = (k: number): ColumnDef<Row>[] => [
      { ...columns[0] },
      { ...columns[2], filterResetKey: k },
    ];
    const { rerender } = render(
      <DataTable<Row>
      ctx={CTX} rows={makeRows(12)} rowKey={r => r.id} columns={cols(1)} testIds={{ row: r => `row-${r.id}` }} />,
    );
    await user.click(screen.getByTestId("button-filter-menu-trigger"));
    await user.type(screen.getByTestId("input-filter-demand-min"), "100");
    await user.type(screen.getByTestId("input-filter-id"), "C1");
    expect(visibleIds()).toEqual(["row-C10", "row-C11", "row-C12"]);
    rerender(<DataTable<Row>
      ctx={CTX} rows={makeRows(12)} rowKey={r => r.id} columns={cols(2)} testIds={{ row: r => `row-${r.id}` }} />);
    // demand range cleared, id text filter "C1" kept → C1, C10, C11, C12
    expect(visibleIds()).toEqual(["row-C1", "row-C10", "row-C11", "row-C12"]);
  });

  it("count testid renders an always-visible 'filtered of total' counter", () => {
    renderTable({ rows: makeRows(4), testIds: { count: "text-x-count" } });
    expect(screen.getByTestId("text-x-count")).toHaveTextContent("4 of 4");
  });
});

describe("DataTable — paging", () => {
  const pagerIds = { row: (r: Row) => `row-${r.id}`, pager: "t-pager", pagerPrev: "t-prev", pagerNext: "t-next", pageIndicator: "t-ind" };

  it("no pager at 50 rows", () => {
    renderTable({ rows: makeRows(50), testIds: pagerIds });
    expect(screen.queryByTestId("t-pager")).toBeNull();
    expect(visibleIds()).toHaveLength(50);
  });

  it("51 rows: pager with literal testids; Next shows row 51", async () => {
    const user = userEvent.setup();
    renderTable({ rows: makeRows(51), testIds: pagerIds });
    expect(screen.getByTestId("t-ind")).toHaveTextContent("Page 1 of 2");
    await user.click(screen.getByTestId("t-next"));
    expect(screen.getByTestId("t-ind")).toHaveTextContent("Page 2 of 2");
    expect(visibleIds()).toEqual(["row-C51"]);
  });

  it("a filter change returns to page 1 and hides the pager once ≤ 50 rows match", async () => {
    const user = userEvent.setup();
    renderTable({ rows: makeRows(120), testIds: pagerIds });
    await user.click(screen.getByTestId("t-next"));
    expect(screen.getByTestId("t-ind")).toHaveTextContent("Page 2 of 3");
    await user.click(screen.getByTestId("button-filter-menu-trigger"));
    await user.type(screen.getByTestId("input-filter-demand-max"), "500");
    expect(screen.queryByTestId("t-pager")).toBeNull();
    expect(visibleIds()[0]).toBe("row-C1");
    expect(visibleIds()).toHaveLength(50);
  });

  it("a filter change that still matches every row also returns to page 1", async () => {
    const user = userEvent.setup();
    renderTable({ rows: makeRows(120), testIds: pagerIds });
    await user.click(screen.getByTestId("t-next"));
    await user.click(screen.getByTestId("button-filter-menu-trigger"));
    await user.type(screen.getByTestId("input-filter-demand-min"), "1");
    expect(screen.getByTestId("t-ind")).toHaveTextContent("Page 1 of 3");
  });

  it("editing a row (same keys, new array) keeps the page", async () => {
    const user = userEvent.setup();
    function Editable() {
      const [rows, setRows] = useState(makeRows(60));
      return (
        <>
          <button onClick={() => setRows(rs => rs.map(r => (r.id === "C55" ? { ...r, demand: 1 } : r)))}>edit</button>
          <DataTable<Row>
      ctx={CTX} rows={rows} rowKey={r => r.id} columns={columns} testIds={pagerIds} />
        </>
      );
    }
    render(<Editable />);
    await user.click(screen.getByTestId("t-next"));
    await user.click(screen.getByText("edit"));
    expect(screen.getByTestId("t-ind")).toHaveTextContent("Page 2 of 2");
    expect(screen.getByTestId("cell-demand-C55")).toHaveTextContent("1");
  });

  it("a NEW columns array with the same ids (adapter rebuilt per render) keeps the filter and the page", async () => {
    const user = userEvent.setup();
    const rows = makeRows(120);
    const { rerender } = render(<DataTable<Row> ctx={CTX} rows={rows} rowKey={r => r.id} columns={columns} testIds={pagerIds} />);
    await user.click(screen.getByTestId("button-filter-menu-trigger"));
    await user.type(screen.getByTestId("input-filter-demand-min"), "100");
    await user.click(screen.getByTestId("t-next"));
    expect(screen.getByTestId("t-ind")).toHaveTextContent("Page 2 of 3");
    rerender(<DataTable<Row> ctx={CTX} rows={rows} rowKey={r => r.id} columns={columns.map(c => ({ ...c }))} testIds={pagerIds} />);
    expect(screen.getByTestId("t-ind")).toHaveTextContent("Page 2 of 3");
    expect(visibleIds()[0]).toBe("row-C60"); // filter kept: unfiltered page 2 would start at C51
  });
});

describe("DataTable — page reset semantics (B2.2)", () => {
  const ids = { row: (r: Row) => `row-${r.id}`, pagerNext: "t-next", pageIndicator: "t-ind" };
  // 120 rows, demand 10…1200; the filter "demand ≤ 1000" keeps C1…C100 (2 pages).
  function Mutable({ mutate }: { mutate: (rows: Row[]) => Row[] }) {
    const [rows, setRows] = useState(makeRows(120));
    return (
      <>
        <button onClick={() => setRows(mutate)}>mutate</button>
        <DataTable<Row> ctx={CTX} rows={rows} rowKey={r => r.id} columns={columns} testIds={ids} />
      </>
    );
  }
  async function onFilteredPage2(mutate: (rows: Row[]) => Row[]) {
    const user = userEvent.setup();
    render(<Mutable mutate={mutate} />);
    await user.click(screen.getByTestId("button-filter-menu-trigger"));
    await user.type(screen.getByTestId("input-filter-demand-max"), "1000");
    await user.keyboard("{Escape}");
    await user.click(screen.getByTestId("t-next"));
    expect(screen.getByTestId("t-ind")).toHaveTextContent("Page 2 of 2");
    await user.click(screen.getByText("mutate"));
    return screen.getByTestId("t-ind").textContent;
  }
  const extra: Row = { id: "X1", city: "X", demand: 5 };

  it("adding a row the filter HIDES resets to page 1", async () => {
    expect(await onFilteredPage2(rs => [...rs, { ...extra, demand: 5000 }])).toBe("Page 1 of 2");
  });
  it("deleting a row the filter HIDES resets to page 1", async () => {
    expect(await onFilteredPage2(rs => rs.filter(r => r.id !== "C120"))).toBe("Page 1 of 2");
  });
  it("adding a row the filter SHOWS resets to page 1", async () => {
    expect(await onFilteredPage2(rs => [...rs, extra])).toBe("Page 1 of 3");
  });
  it("deleting a row the filter SHOWS resets to page 1", async () => {
    expect(await onFilteredPage2(rs => rs.filter(r => r.id !== "C1"))).toBe("Page 1 of 2");
  });
  it("editing a filtered column so a row leaves the filter keeps the page (same key set)", async () => {
    expect(await onFilteredPage2(rs => rs.map(r => (r.id === "C60" ? { ...r, demand: 5000 } : r)))).toBe("Page 2 of 2");
    expect(screen.queryByTestId("row-C60")).toBeNull();
  });
  it("reordering the rows keeps the page", async () => {
    expect(await onFilteredPage2(rs => [...rs].reverse())).toBe("Page 2 of 2");
  });
});

describe("DataTable — empty, toolbar, footer", () => {
  it("empty rows render emptyState (with its testid) instead of the table; toolbar slots still render", () => {
    renderTable({
      rows: [],
      emptyState: "Nothing here",
      testIds: { empty: "t-empty", toolbar: "t-toolbar" },
      toolbar: { download: <button data-testid="dl">CSV</button> },
    });
    expect(screen.getByTestId("t-empty")).toHaveTextContent("Nothing here");
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.getByTestId("t-toolbar")).toContainElement(screen.getByTestId("dl"));
  });

  it("toolbar slots render in upload, download, add, extra order; footer after the table", () => {
    renderTable({
      toolbar: {
        extra: <span>extra</span>,
        add: <span>add</span>,
        download: <span>download</span>,
        upload: <span>upload</span>,
      },
      footer: <p data-testid="t-footer">note</p>,
    });
    const order = ["upload", "download", "add", "extra"].map(t => screen.getByText(t));
    for (let i = 1; i < order.length; i++) {
      expect(order[i - 1].compareDocumentPosition(order[i]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
    expect(screen.getByRole("table").compareDocumentPosition(screen.getByTestId("t-footer")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("downloadAlign 'right' renders download last — after the count and the filter trigger", () => {
    renderTable({
      rows: makeRows(11),
      testIds: { row: r => `row-${r.id}`, count: "t-count" },
      toolbar: { upload: <span>upload</span>, download: <span data-testid="dl">download</span>, downloadAlign: "right" },
    });
    const dl = screen.getByTestId("dl");
    expect(dl.parentElement!.lastElementChild).toBe(dl);
    for (const before of [screen.getByText("upload"), screen.getByTestId("t-count"), screen.getByTestId("button-filter-menu-trigger")]) {
      expect(before.compareDocumentPosition(dl) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
  });
});

describe("DataTable — sections", () => {
  const base = makeRows(3);
  const added: Row[] = [{ id: "A1", city: "New", demand: null, added: true }];
  const deleteCol: ColumnDef<Row> = { id: "del", header: "", kind: "text", value: () => null, cell: r => <button data-testid={`del-${r.id}`}>x</button>, filter: false };

  const sectioned = (rows: Row[]) =>
    render(
      <DataTable<Row>
      ctx={CTX}
        rows={rows}
        rowKey={r => r.id}
        columns={columns}
        sections={[
          { id: "base", testId: "sec-base", tableTestId: "tbl-base", includes: r => !r.added, emptyState: <p data-testid="base-empty">No dataset rows</p> },
          {
            id: "added",
            title: "Added customers",
            testId: "sec-added",
            scrollTestId: "scroll-added",
            includes: r => !!r.added,
            columns: [...columns, deleteCol],
            rowTestId: r => `row-added-${r.id}`,
            footer: <button data-testid="button-add-customer-row">+ Add</button>,
          },
        ]}
        testIds={{ row: r => `row-${r.id}` }}
      />,
    );

  it("splits rows into titled groups with per-section columns and row testids", () => {
    sectioned([...base, ...added]);
    expect(within(screen.getByTestId("tbl-base")).getAllByRole("row")).toHaveLength(4); // header + 3
    expect(screen.getByTestId("row-C1")).toBeInTheDocument();
    expect(screen.getByTestId("row-added-A1")).toBeInTheDocument();
    expect(within(screen.getByTestId("sec-added")).getByText("Added customers")).toBeInTheDocument();
    expect(screen.getByTestId("scroll-added")).toContainElement(screen.getByTestId("del-A1"));
    expect(within(screen.getByTestId("tbl-base")).queryByText("x")).toBeNull();
  });

  it("an empty base section shows its own emptyState; the added section and its footer still render", () => {
    sectioned(added);
    expect(screen.getByTestId("base-empty")).toBeInTheDocument();
    expect(screen.getByTestId("row-added-A1")).toBeInTheDocument();
    expect(screen.getByTestId("button-add-customer-row")).toBeInTheDocument();
  });

  it("a section footer renders even when that section has no rows", () => {
    sectioned(base);
    expect(screen.queryByTestId("scroll-added")).toBeNull();
    expect(screen.getByTestId("button-add-customer-row")).toBeInTheDocument();
  });

  it("base and added share ONE filter menu", () => {
    sectioned([...makeRows(11), ...added]);
    expect(screen.getAllByTestId("button-filter-menu-trigger")).toHaveLength(1);
  });

  it("pages across the concatenated list: added rows appended after base", async () => {
    const user = userEvent.setup();
    render(
      <DataTable<Row>
      ctx={CTX}
        rows={[...makeRows(50), ...added]}
        rowKey={r => r.id}
        columns={columns}
        sections={[
          { id: "base", testId: "sec-base", includes: r => !r.added },
          { id: "added", testId: "sec-added", includes: r => !!r.added },
        ]}
        testIds={{ row: r => `row-${r.id}`, pagerNext: "t-next" }}
      />,
    );
    expect(screen.queryByTestId("sec-added")).toBeNull();
    await user.click(screen.getByTestId("t-next"));
    expect(screen.queryByTestId("sec-base")).toBeNull();
    expect(screen.getByTestId("row-A1")).toBeInTheDocument();
  });
});

describe("DataTable — focus jump", () => {
  function Focusable({ rows }: { rows: Row[] }) {
    const [focus, setFocus] = useState<DataTableFocus<Row> | null>(null);
    return (
      <>
        <button onClick={() => setFocus({ token: Date.now(), matches: r => r.id === "C75" })}>jump</button>
        <DataTable<Row>
      ctx={CTX} rows={rows} rowKey={r => r.id} columns={columns} focus={focus} testIds={{ row: r => `row-${r.id}`, pageIndicator: "t-ind" }} />
      </>
    );
  }

  it("clears filters, lands on the target's page and scrolls the row into view", async () => {
    const user = userEvent.setup();
    render(<Focusable rows={makeRows(120)} />);
    await user.click(screen.getByTestId("button-filter-menu-trigger"));
    await user.type(screen.getByTestId("input-filter-demand-max"), "100");
    expect(screen.queryByTestId("t-ind")).toBeNull();
    await user.keyboard("{Escape}");
    await user.click(screen.getByText("jump"));
    expect(screen.getByTestId("t-ind")).toHaveTextContent("Page 2 of 3");
    expect(screen.getByTestId("row-C75")).toBeInTheDocument();
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
  });

  it("a focus that matches nothing leaves page and filters alone", async () => {
    const user = userEvent.setup();
    function NoMatch() {
      const [focus, setFocus] = useState<DataTableFocus<Row> | null>(null);
      return (
        <>
          <button onClick={() => setFocus({ token: 1, matches: () => false })}>jump</button>
          <DataTable<Row>
      ctx={CTX} rows={makeRows(120)} rowKey={r => r.id} columns={columns} focus={focus} testIds={{ pagerNext: "t-next", pageIndicator: "t-ind" }} />
        </>
      );
    }
    render(<NoMatch />);
    await user.click(screen.getByTestId("t-next"));
    await user.click(screen.getByText("jump"));
    expect(screen.getByTestId("t-ind")).toHaveTextContent("Page 2 of 3");
  });
});
```

- [ ] **Step 6: Run it to verify it fails**

Run: `pnpm --filter studio exec vitest run src/__tests__/DataTable.test.tsx`
Expected: FAIL — `Error: Failed to resolve import "@/components/data-table/DataTable" from "src/__tests__/DataTable.test.tsx". Does the file exist?`

- [ ] **Step 7: Write the shell**

Create `artifacts/studio/src/components/data-table/DataTable.tsx`:

```tsx
// SCU-2.P1 (spec B2.1/B2.2) — the one rendering shell every Workspace table
// is migrated onto in P3/P4. The adapter supplies effective rows, columns and
// a literal testid map; the shell owns filter → clamp → slice 50, the filter
// menu (> 10 rows), the pager (> 50 filtered rows), focus jumps and layout.
// It renders real <table>/<thead>/<th>/<tr>/<td> (e2e reads `thead th` text),
// puts `cell()` output directly in the <td> (no wrapper element), and never
// adds a column of its own.

import { useEffect, useMemo, useRef, type ReactNode } from "react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { FilterMenu } from "@/components/tables/FilterMenu";
import { useTableFilters } from "@/lib/useTableFilters";
import { cn } from "@/lib/utils";
import { deriveFilterDescriptors, FILTER_ROW_THRESHOLD } from "./deriveFilterDescriptors";
import { PAGE_SIZE, pageResetKey, usePagedRows } from "./usePagedRows";
import { TablePager } from "./TablePager";
import type { CellContext, ColumnDef, DataTableProps, DataTableSection } from "./types";

const KEY_SEP = "\u0000";
const never = () => false;

export function DataTable<T>({
  rows,
  rowKey,
  columns,
  testIds = {},
  rowClassName,
  ctx: ctxIn,
  toolbar,
  emptyState,
  noMatchText = "No rows match the current filter.",
  sections,
  focus,
  scrollClassName,
  footer,
}: DataTableProps<T>) {
  const ctx: CellContext<T> = {
    readOnly: ctxIn.readOnly,
    demandEditable: ctxIn.demandEditable,
    isOverridden: ctxIn.isOverridden ?? never,
    isChanged: ctxIn.isChanged ?? never,
    isAdded: ctxIn.isAdded ?? never,
  };

  // Pipeline (B2.2, fixed order): effective rows (adapter) → filter → clamp page → slice 50.
  const descriptors = useMemo(() => deriveFilterDescriptors(columns, rows), [columns, rows]);
  const tableFilters = useTableFilters(rows, descriptors);
  const { filteredRows, filterState, setFilter, clearAll } = tableFilters;
  // Reset key = canonical filter state + sorted key set of ALL effective rows
  // (pageResetKey): any filter change or add/delete resets to page 1; a cell
  // edit or a reorder does not.
  const resetKey = useMemo(() => pageResetKey(rows, rowKey, filterState), [rows, rowKey, filterState]);
  // The key the table will have once a focus jump has cleared every filter.
  const clearedKey = useMemo(() => pageResetKey(rows, rowKey, {}), [rows, rowKey]);
  const paged = usePagedRows(filteredRows, resetKey);

  // Per-column filter reset: a changed `filterResetKey` clears only that column's filter.
  const resetSignature = columns.map(c => `${c.id}=${c.filterResetKey ?? ""}`).join(KEY_SEP);
  const lastReset = useRef<Record<string, string | number>>({});
  useEffect(() => {
    for (const c of columns) {
      if (c.filterResetKey === undefined) continue;
      const prev = lastReset.current[c.id];
      if (prev !== undefined && prev !== c.filterResetKey) setFilter(c.id, undefined);
      lastReset.current[c.id] = c.filterResetKey;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetSignature]);

  // Focus jump (today's behaviour, DistancesTab.tsx:459-467): clear every filter,
  // go to the page of the first matching row in the now-unfiltered list, then
  // scroll that row into view once its page has rendered.
  const rootRef = useRef<HTMLDivElement>(null);
  const pendingScrollKey = useRef<string | null>(null);
  useEffect(() => {
    if (!focus) return;
    const idx = rows.findIndex(focus.matches);
    if (idx < 0) return;
    clearAll();
    paged.setPage(Math.floor(idx / PAGE_SIZE) + 1, clearedKey);
    pendingScrollKey.current = rowKey(rows[idx]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus?.token]);
  useEffect(() => {
    const key = pendingScrollKey.current;
    if (key === null || !rootRef.current) return;
    const el = Array.from(rootRef.current.querySelectorAll("tr[data-row-key]")).find(
      tr => tr.getAttribute("data-row-key") === key,
    );
    if (el) {
      el.scrollIntoView({ block: "center" });
      pendingScrollKey.current = null;
    }
  });

  const noMatch = rows.length > 0 && filteredRows.length === 0;
  const showFilter = rows.length > FILTER_ROW_THRESHOLD;

  const renderTable = (
    allCols: ColumnDef<T>[],
    bodyRows: T[],
    opts: { tableTestId?: string; rowTestId?: (row: T) => string; showNoMatch: boolean },
  ) => {
    const cols = allCols.filter(c => !c.hidden);
    return (
      <Table className="table-auto" data-testid={opts.tableTestId}>
        <TableHeader>
          <TableRow>
            {cols.map(c => (
              <TableHead
                key={c.id}
                className={cn("h-auto px-3 py-1.5 whitespace-nowrap", c.kind === "number" && "text-center")}
                data-testid={c.headerTestId}
              >
                {c.header}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {bodyRows.map(row => {
            const key = rowKey(row);
            return (
              <TableRow key={key} data-row-key={key} data-testid={opts.rowTestId?.(row)} className={rowClassName?.(row, ctx)}>
                {cols.map(c => (
                  <TableCell
                    key={c.id}
                    className={cn("px-3 py-1.5", c.kind === "number" && "text-center", c.cellClassName)}
                    data-testid={c.cellTestId?.(row)}
                  >
                    {c.cell(row, ctx)}
                  </TableCell>
                ))}
              </TableRow>
            );
          })}
          {opts.showNoMatch && (
            <TableRow>
              <TableCell colSpan={cols.length} className="px-3 py-3 text-xs text-muted-foreground text-center" data-testid={testIds.noMatch}>
                {noMatchText}
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    );
  };

  const renderSections = (list: DataTableSection<T>[]) => {
    const firstSection = (row: T) => list.find(s => s.includes(row));
    const onPage = new Map<string, T[]>(list.map(s => [s.id, []]));
    for (const row of paged.pageRows) {
      const s = firstSection(row);
      if (s) onPage.get(s.id)!.push(row);
    }
    const owners = new Set(rows.map(r => firstSection(r)?.id));
    const noMatchSectionId = list.find(s => owners.has(s.id))?.id;
    return list.map(s => {
      const pageRows = onPage.get(s.id)!;
      const owned = owners.has(s.id);
      const showNoMatch = noMatch && s.id === noMatchSectionId;
      let content: ReactNode = null;
      if (!owned) content = s.emptyState ?? null;
      else if (pageRows.length > 0 || showNoMatch)
        content = (
          <div className={s.scrollClassName} data-testid={s.scrollTestId}>
            {renderTable(s.columns ?? columns, pageRows, {
              tableTestId: s.tableTestId,
              rowTestId: s.rowTestId ?? testIds.row,
              showNoMatch,
            })}
          </div>
        );
      if (content === null && !s.footer) return null;
      return (
        <div key={s.id} data-testid={s.testId} className="space-y-1">
          {s.title && <div className="px-1 text-xs font-medium text-muted-foreground">{s.title}</div>}
          {content}
          {s.footer}
        </div>
      );
    });
  };

  let body: ReactNode;
  if (rows.length === 0 && emptyState !== undefined) {
    body = <div data-testid={testIds.empty}>{emptyState}</div>;
  } else {
    body = (
      <>
        {sections ? (
          <div className="space-y-3">{renderSections(sections)}</div>
        ) : (
          <div className={scrollClassName} data-testid={testIds.scroll}>
            {renderTable(columns, paged.pageRows, { tableTestId: testIds.table, rowTestId: testIds.row, showNoMatch: noMatch })}
          </div>
        )}
        {paged.showPager && (
          <TablePager
            page={paged.page}
            pageCount={paged.pageCount}
            onPageChange={p => paged.setPage(p)}
            testIds={{ pager: testIds.pager, prev: testIds.pagerPrev, next: testIds.pagerNext, indicator: testIds.pageIndicator }}
          />
        )}
      </>
    );
  }

  const hasToolbar = Boolean(
    toolbar?.upload || toolbar?.download || toolbar?.add || toolbar?.extra || showFilter || testIds.count || testIds.toolbar,
  );

  return (
    <div ref={rootRef} data-testid={testIds.root}>
      {hasToolbar && (
        <div className="mb-2 flex flex-wrap items-center gap-1.5" data-testid={testIds.toolbar}>
          {toolbar?.upload}
          {toolbar?.downloadAlign !== "right" && toolbar?.download}
          {toolbar?.add}
          {toolbar?.extra}
          <div className="ml-auto flex items-center gap-2">
            {testIds.count && (
              <span className="text-xs text-muted-foreground" data-testid={testIds.count}>
                {tableFilters.filteredCount} of {tableFilters.totalCount}
              </span>
            )}
            {showFilter && <FilterMenu descriptors={descriptors} tableFilters={tableFilters} triggerTestId={testIds.filterTrigger} />}
            {toolbar?.downloadAlign === "right" && toolbar?.download}
          </div>
        </div>
      )}
      {body}
      {footer}
    </div>
  );
}
```

- [ ] **Step 8: Run it to verify it passes**

Run: `pnpm --filter studio exec vitest run src/__tests__/DataTable.test.tsx src/components/tables/FilterMenu.test.tsx src/__tests__/ImportDialog.test.tsx`
Expected: PASS — `DataTable.test.tsx` 36 tests, `FilterMenu.test.tsx` 12, `ImportDialog.test.tsx` 10 (measured at plan time). Then `pnpm --filter studio typecheck` must exit 0: it is what enforces the `@ts-expect-error` "ctx is required" test (an unused directive is itself a type error).

- [ ] **Step 9: e2e sweep**

`FilterMenu`'s default trigger testid is unchanged, no tab renders `DataTable`, and no existing accessor returns `EMPTY_FILTER_VALUE` (it is new), so no rendered testid or text changes. Prove it: `grep -rn 'button-filter-menu-trigger' artifacts/studio/src --include='*.tsx' | grep -v __tests__ | grep -v '\.test\.'` → only `FilterMenu.tsx` (the default), and `grep -rn 'EMPTY_FILTER_VALUE' artifacts/studio/src --include='*.ts' --include='*.tsx' | grep -v __tests__ | grep -v '\.test\.'` → only `useTableFilters.ts`, `FilterMenu.tsx`, `deriveFilterDescriptors.ts`. Record `e2e: n/a (no rendered testid changes)`.

- [ ] **Step 10: Gate**

Run each separately:
1. `cnt=$(ps aux | grep "[v]itest" | grep -v "zsh -c" | wc -l | tr -d ' '); [ "$cnt" = "0" ]`
2. `pnpm run typecheck`
3. `pnpm --filter studio typecheck:e2e`
4. `DATABASE_URL="postgresql://shubhamkr@localhost:5432/nos_dev" pnpm --filter api-server test`
5. `pnpm --filter studio test`
6. `(cd artifacts/api-server/src/solver && python3 -m pytest tests/ -x)`

Expected: every command exits 0.

- [ ] **Step 11: Changelog**

Append to the bottom of `docs/CHANGELOG-implementation.md`:

```markdown

### SCU-2.P1.4 — DataTable shell

- `components/data-table/DataTable.tsx`: effective rows → filter (FilterMenu > 10 rows, descriptors from columns) → clamp → slice 50 (pager > 50); reset key = canonical filters + sorted all-row keys (filtered-out/-in add/delete reset; filter-column edit and reorder keep the page); sections share one menu/pager; focus jump (clear filters, then index the unfiltered list — spec rev 4); per-column filter reset; required `ctx`; literal testids, `cell()` placed directly in the `<td>`, number columns centred. `FilterMenu` gains optional `triggerTestId` (default unchanged) and displays the empty token as "(empty)".
- Deviations 1, 2, 3, 5, 7, 8. No consumers yet.
- Gate: studio <N passed>, api-server <N passed>, pytest <N passed>. e2e: n/a (no rendered testid changes).
```

- [ ] **Step 12: Commit**

```bash
git add artifacts/studio/src/components/data-table/DataTable.tsx artifacts/studio/src/__tests__/DataTable.test.tsx
```

```bash
[ "$(git rev-parse --abbrev-ref HEAD)" != "main" ] || exit 1
```

```bash
git commit artifacts/studio/src/components/data-table/DataTable.tsx artifacts/studio/src/__tests__/DataTable.test.tsx artifacts/studio/src/components/tables/FilterMenu.tsx artifacts/studio/src/components/tables/FilterMenu.test.tsx docs/CHANGELOG-implementation.md -m "[SCU-2.P1.4] add DataTable shell and FilterMenu trigger testid" -m "Deviations 1, 2, 3, 5, 7, 8. No table migrated; FilterMenu default testid unchanged." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task SCU-2.P1.5: Replica harness — DataTable reproduces DistancesTab's complete testid map (B2.1 "explicit literal mapping")

**Owner role:** frontend-engineer. **Spec:** B2.1 `testIds` ("each adapter maps to the testids that table emits today"), B2.2 (From/To boxes removed, pager > 50). **Deviation:** 1.

**Files:**
- Test: `artifacts/studio/src/__tests__/DataTable.distancesReplica.test.tsx`
- Modify: `docs/CHANGELOG-implementation.md` (append `### SCU-2.P1.5`)

**Interfaces:**
- Consumes: `DataTable`, `ColumnDef`, `DataTableTestIds` (P1.2/P1.4); the real `DistancesTab` and its exported `DistanceOverride` type (`components/workspace/tabs/DistancesTab.tsx:17-27`, unchanged); `EntityIdCell` (`components/tables/EntityIdCell.tsx`, emits no testid); `AllProviders` (`src/__tests__/helpers/renderWithExportProvider.tsx` — `UnitProvider` + `ExportProvider`, which `DistancesTab`'s export buttons and unit draft need) plus a `QueryClientProvider`.
- Produces: no production code. The adapter in the test is the documented starting point for the P4 Distances migration.

**What it proves:** with a 60-row fixture (no reference matrix, so no fetch; WH03 and C020 unknown → warning icons; one estimated row; two changed rows on page 2), the **complete** testid multiset under the root `distances-tab` — root, toolbar and its buttons, table, rows, cells, pager, empty state, filter trigger, add-row trigger — emitted by the **real** `DistancesTab` equals the set emitted by a `DataTable` adapter on page 1, on page 2 and in the empty state, after applying only B2.2's two deliberate changes (From/To boxes removed; FilterMenu trigger added when > 10 rows). Headers, row order and amber highlighting also match. The filter trigger is asserted inside the **replica's** own toolbar. Five built-in deliberate breaks — wrong `root`, `toolbar`, `filterTrigger`, an extra `table` id, wrong `row` — must each make the complete-set comparison fail, so the comparison provably detects each mapping. Non-vacuity: > 150 ids on page 1, and `badge-distance-changed-WH03-C020` on page 2. Toolbar buttons in the replica are inert stand-ins carrying the real testids (their behaviour is P2/P4's).

- [ ] **Step 0: Invoke the simplicity skills**

Skill tool: `andrej-karpathy-skills:karpathy-guidelines`, then `ponytail:ponytail`. Record in the report that both ran.

- [ ] **Step 1: Write the test**

Create `artifacts/studio/src/__tests__/DataTable.distancesReplica.test.tsx`:

```tsx
// SCU-2.P1.5 — proves the DataTable testid-mapping API can reproduce a real
// table's testids. Renders the REAL DistancesTab and a DataTable adapter fed
// the same rows, then compares every testid inside the table and pager.
// No production table is migrated here; the adapter below is test-only and
// is the template the P4 DistancesTab migration starts from.
//
// The comparison is the COMPLETE testid multiset under each root
// (`distances-tab`): root, toolbar, scroll/table, rows, cells, pager, empty
// state, filter trigger and the add-row trigger. Expected, spec-mandated
// differences (B2.2), applied to the real set before comparing:
//   - `input-filter-from` / `input-filter-to` boxes are removed;
//   - the FilterMenu trigger `button-filter-menu-trigger` appears (> 10 rows).
// The fixture has 60 rows so both pagers render (DataTable: > 50 only).
// Toolbar buttons are inert stand-ins with the real testids (their behaviour
// is P2/P4's); only the testid contract is under test here.

import { describe, expect, it, vi, beforeEach } from "vitest";
import type { ReactNode } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AlertTriangle, X } from "lucide-react";
import { AllProviders } from "@/__tests__/helpers/renderWithExportProvider";
import { DistancesTab, type DistanceOverride } from "@/components/workspace/tabs/DistancesTab";
import { EntityIdCell } from "@/components/tables/EntityIdCell";
import { DataTable } from "@/components/data-table/DataTable";
import type { ColumnDef, DataTableTestIds } from "@/components/data-table/types";

interface MergedRow {
  fromId: string;
  toId: string;
  base: number | null;
  override?: DistanceOverride;
}

// 3 warehouses × 20 customers = 60 rows. WH03 and C020 are unknown ids (warning icons).
const current: DistanceOverride[] = [];
for (const w of ["WH01", "WH02", "WH03"]) {
  for (let c = 1; c <= 20; c++) {
    current.push({ fromId: w, toId: `C${String(c).padStart(3, "0")}`, distance: 100 + c, estimated: w === "WH02" && c === 5 });
  }
}
// Saved state: the last row is new (unsaved) and the second-to-last differs → both "Changed".
const saved = current.slice(0, 59).map((o, i) => (i === 58 ? { ...o, distance: 1 } : o));
const warehouseIds = ["WH01", "WH02"];
const customerIds = Array.from({ length: 19 }, (_, i) => `C${String(i + 1).padStart(3, "0")}`);

const savedByKey = new Map(saved.map(o => [`${o.fromId}|${o.toId}`, o]));
const isChanged = (r: MergedRow) => {
  const s = savedByKey.get(`${r.fromId}|${r.toId}`);
  if (!s && !r.override) return false;
  if (!s || !r.override) return true;
  return s.distance !== r.override.distance;
};

// The adapter: columns + literal testid map reproducing DistancesTab.tsx:733-856.
const columns: ColumnDef<MergedRow>[] = [
  {
    id: "from",
    header: "From",
    kind: "text",
    filter: "text",
    value: r => r.fromId,
    cellClassName: "text-xs",
    cell: r => (
      <div className="flex items-center gap-1">
        <EntityIdCell entityId={r.fromId} displayId={r.fromId} />
        {!warehouseIds.includes(r.fromId) && (
          <span data-testid={`warning-unknown-from-${r.fromId}-${r.toId}`}>
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
    value: r => r.toId,
    cellClassName: "text-xs",
    cell: r => (
      <div className="flex items-center gap-1">
        <EntityIdCell entityId={r.toId} displayId={r.toId} />
        {!customerIds.includes(r.toId) && (
          <span data-testid={`warning-unknown-to-${r.fromId}-${r.toId}`}>
            <AlertTriangle className="w-3 h-3 text-amber-600" />
          </span>
        )}
      </div>
    ),
  },
  { id: "base", header: "Base (mi)", kind: "number", value: r => r.base, cellClassName: "font-mono text-xs", cell: r => r.base ?? "—" },
  {
    id: "override",
    header: "Override (mi)",
    kind: "number",
    value: r => r.override?.distance ?? null,
    cell: r => (
      <div className="flex items-center gap-1.5">
        <input readOnly value={r.override?.distance ?? ""} data-testid={`input-distance-${r.fromId}-${r.toId}`} />
        {r.override?.estimated && <span data-testid={`badge-distance-estimated-${r.fromId}-${r.toId}`}>Estimated</span>}
        {isChanged(r) && <span data-testid={`badge-distance-changed-${r.fromId}-${r.toId}`}>Changed</span>}
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
        <button type="button" data-testid={`button-remove-distance-${r.fromId}-${r.toId}`}>
          <X className="w-3.5 h-3.5" />
        </button>
      ),
  },
];

const testIds: DataTableTestIds<MergedRow> = {
  root: "distances-tab",
  toolbar: "distances-tab-toolbar",
  row: r => `row-distance-${r.fromId}-${r.toId}`,
  pagerPrev: "button-distances-prev",
  pagerNext: "button-distances-next",
  pageIndicator: "distances-page-indicator",
  empty: "distances-tab-empty",
};

// Today's row order: base pairs, then added (here: no reference matrix → all rows are "added").
const rows: MergedRow[] = current.map(o => ({ fromId: o.fromId, toId: o.toId, base: null, override: o }));

function Providers({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={client}>
      <AllProviders>{children}</AllProviders>
    </QueryClientProvider>
  );
}

/** Every data-testid at or under `root`, sorted (a multiset: duplicates are kept). */
function allTestIds(root: HTMLElement): string[] {
  return [root, ...Array.from(root.querySelectorAll("[data-testid]"))]
    .map(el => el.getAttribute("data-testid"))
    .filter((id): id is string => id !== null)
    .sort();
}

/** The real set after B2.2's two deliberate changes. */
function expectedFromReal(realIds: string[], filterShown: boolean): string[] {
  const kept = realIds.filter(id => id !== "input-filter-from" && id !== "input-filter-to");
  return (filterShown ? [...kept, "button-filter-menu-trigger"] : kept).sort();
}

const EMPTY_TEXT = "No distance overrides yet — add one below, or upload a CSV/JSON file.";

function Replica({ data, ids = testIds }: { data: MergedRow[]; ids?: DataTableTestIds<MergedRow> }) {
  return (
    <DataTable<MergedRow>
      rows={data}
      rowKey={r => `${r.fromId}|${r.toId}`}
      columns={columns}
      testIds={ids}
      ctx={{ readOnly: false, demandEditable: true, isChanged }}
      rowClassName={(r, ctx) => (ctx.isChanged(r) ? "bg-amber-50" : r.override?.estimated ? "bg-sky-50" : undefined)}
      scrollClassName="max-h-[55vh] overflow-y-auto"
      emptyState={EMPTY_TEXT}
      toolbar={{
        download: (
          <>
            <button type="button" data-testid="button-export-distances-csv">CSV</button>
            <button type="button" data-testid="button-export-distances-json">JSON</button>
          </>
        ),
        upload: <button type="button" data-testid="button-import-distances">Upload</button>,
      }}
      footer={<button type="button" data-testid="button-add-distance-row">+ Add row</button>}
    />
  );
}

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

function renderReal(overrides: DistanceOverride[], savedOverrides: DistanceOverride[]) {
  const real = render(
    <DistancesTab
      distanceOverrides={overrides}
      savedDistanceOverrides={savedOverrides}
      warehouseIds={warehouseIds}
      customerIds={customerIds}
      onChange={vi.fn()}
      canonicalUnit="mi"
    />,
    { wrapper: Providers },
  );
  return { real, realRoot: real.getByTestId("distances-tab") };
}

describe("DataTable reproduces DistancesTab's testid map (P1 replica harness)", () => {
  function measureReal() {
    const { real, realRoot } = renderReal(current, saved);
    const page1 = allTestIds(realRoot);
    const headers = within(realRoot).getAllByRole("columnheader").map(th => th.textContent);
    const rowClasses = within(realRoot)
      .getAllByTestId(/^row-distance-/)
      .map(tr => [tr.getAttribute("data-testid"), tr.className.includes("bg-amber-50")]);
    fireEvent.click(within(realRoot).getByTestId("button-distances-next"));
    const page2 = allTestIds(realRoot);
    real.unmount();
    return { page1, page2, headers, rowClasses };
  }

  it("emits the identical complete testid set under the root, on page 1 and page 2", () => {
    const real = measureReal();
    // Non-vacuity: 50 rows × (row + input + remove) = 150, plus warnings, badges, toolbar and pager.
    expect(real.page1.length).toBeGreaterThan(150);
    expect(real.page1).toEqual(expect.arrayContaining(["distances-tab", "distances-tab-toolbar", "button-add-distance-row"]));
    expect(real.page2).toContain("badge-distance-changed-WH03-C020");
    const { getByTestId } = render(<Replica data={rows} />);
    const replicaRoot = getByTestId("distances-tab");
    expect(allTestIds(replicaRoot)).toEqual(expectedFromReal(real.page1, true));
    fireEvent.click(within(replicaRoot).getByTestId("button-distances-next"));
    expect(allTestIds(replicaRoot)).toEqual(expectedFromReal(real.page2, true));
  });

  it("the filter trigger is the REPLICA's own, inside its toolbar", () => {
    const { getByTestId } = render(<Replica data={rows} />);
    const toolbar = within(getByTestId("distances-tab")).getByTestId("distances-tab-toolbar");
    expect(within(toolbar).getByTestId("button-filter-menu-trigger")).toBeInTheDocument();
    expect(within(getByTestId("distances-tab")).getByTestId("distances-page-indicator")).toHaveTextContent("Page 1 of 2");
  });

  it("empty state: identical complete testid set (no filter trigger at 0 rows)", () => {
    const { real, realRoot } = renderReal([], []);
    const realEmpty = allTestIds(realRoot);
    real.unmount();
    expect(realEmpty).toContain("distances-tab-empty");
    const { getByTestId } = render(<Replica data={[]} />);
    expect(allTestIds(getByTestId("distances-tab"))).toEqual(expectedFromReal(realEmpty, false));
    expect(screen.getByTestId("distances-tab-empty")).toHaveTextContent("No distance overrides yet");
  });

  it("renders the same headers in the same order", () => {
    const real = measureReal();
    const { getByTestId } = render(<Replica data={rows} />);
    expect(within(getByTestId("distances-tab")).getAllByRole("columnheader").map(th => th.textContent)).toEqual(real.headers);
  });

  it("renders the same rows in the same order with the same amber 'changed' highlighting", () => {
    const real = measureReal();
    const { getByTestId } = render(<Replica data={rows} />);
    const replicaRowClasses = within(getByTestId("distances-tab"))
      .getAllByTestId(/^row-distance-/)
      .map(tr => [tr.getAttribute("data-testid"), tr.className.includes("bg-amber-50")]);
    expect(replicaRowClasses).toEqual(real.rowClasses);
  });

  // Deliberate breaks: each wrong mapping must make the complete-set comparison fail.
  it.each<[string, DataTableTestIds<MergedRow>]>([
    ["root", { ...testIds, root: "distances-tab-x" }],
    ["toolbar", { ...testIds, toolbar: "distances-tab-toolbar-x" }],
    ["filter trigger", { ...testIds, filterTrigger: "button-filter-x" }],
    ["table (an id the real table does not emit)", { ...testIds, table: "distances-table" }],
    ["row", { ...testIds, row: r => `row-dist-${r.fromId}-${r.toId}` }],
  ])("a wrong %s mapping is detected", (_name, broken) => {
    const real = measureReal();
    const { container } = render(<Replica data={rows} ids={broken} />);
    const replicaRoot = container.firstElementChild as HTMLElement;
    expect(allTestIds(replicaRoot)).not.toEqual(expectedFromReal(real.page1, true));
  });
});
```

- [ ] **Step 2: Run it to verify it passes (the deliberate breaks are part of it)**

Run: `pnpm --filter studio exec vitest run src/__tests__/DataTable.distancesReplica.test.tsx src/__tests__/DistancesTab.test.tsx`
Expected: PASS — replica 10 tests (5 parity/scoping/empty/header/row tests + 5 "a wrong … mapping is detected"); `DistancesTab.test.tsx` 64 tests unchanged (measured at plan time). The replica file renders the real tab repeatedly and took ~14–22 s in isolation at plan time; if it times out under load, check `docs/superpowers/flake-registry.md` and re-run in isolation before changing anything.

- [ ] **Step 3: Prove a parity break is caught outside the it.each too**

In the test's top-level `testIds` object, temporarily change `toolbar: "distances-tab-toolbar"` to `toolbar: "distances-toolbar"` and re-run the file. Expected: FAIL — `Tests  3 failed | 7 passed (10)`: "emits the identical complete testid set …", "the filter trigger is the REPLICA's own …" and "empty state: identical complete testid set …" (measured at plan time). Revert the change and re-run → PASS.

- [ ] **Step 4: e2e sweep**

Test-only file. `git diff --name-only HEAD -- artifacts/studio/e2e artifacts/studio/src/components artifacts/studio/src/pages` → empty. Record `e2e: n/a (test only)`.

- [ ] **Step 5: Gate**

Run each separately:
1. `cnt=$(ps aux | grep "[v]itest" | grep -v "zsh -c" | wc -l | tr -d ' '); [ "$cnt" = "0" ]`
2. `pnpm run typecheck`
3. `pnpm --filter studio typecheck:e2e`
4. `DATABASE_URL="postgresql://shubhamkr@localhost:5432/nos_dev" pnpm --filter api-server test`
5. `pnpm --filter studio test`
6. `(cd artifacts/api-server/src/solver && python3 -m pytest tests/ -x)`

Expected: every command exits 0.

- [ ] **Step 6: Changelog**

Append to the bottom of `docs/CHANGELOG-implementation.md`:

```markdown

### SCU-2.P1.5 — DistancesTab replica harness

- `__tests__/DataTable.distancesReplica.test.tsx`: real `DistancesTab` vs a DataTable adapter on a 60-row fixture — identical COMPLETE testid multisets under `distances-tab` on pages 1 and 2 and in the empty state (<N> ids on page 1), identical headers and amber rows, filter trigger scoped to the replica's toolbar; only differences are B2.2's (From/To boxes removed, FilterMenu trigger added). Five built-in deliberate breaks (root, toolbar, filter trigger, table, row) each fail the comparison.
- Gate: studio <N passed>, api-server <N passed>, pytest <N passed>. e2e: n/a (test only).
```

- [ ] **Step 7: Commit**

```bash
git add artifacts/studio/src/__tests__/DataTable.distancesReplica.test.tsx
```

```bash
[ "$(git rev-parse --abbrev-ref HEAD)" != "main" ] || exit 1
```

```bash
git commit artifacts/studio/src/__tests__/DataTable.distancesReplica.test.tsx docs/CHANGELOG-implementation.md -m "[SCU-2.P1.5] prove DataTable reproduces DistancesTab testids" -m "Complete scoped testid sets, pages 1/2 + empty; built-in breaks for root/toolbar/filter/table/row. Test-only; adapter is the P4 Distances migration template." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task SCU-2.P1.6: `FormattedNumberInput` (B2.9)

**Owner role:** frontend-engineer. **Spec:** B2.9 rev 4 (all component bullets), D3. **Deviations:** 10, 11, 12.

**Files:**
- Create: `artifacts/studio/src/components/data-table/FormattedNumberInput.tsx`
- Test: `artifacts/studio/src/__tests__/FormattedNumberInput.test.tsx`
- Modify: `docs/CHANGELOG-implementation.md` (append `### SCU-2.P1.6`)

**Interfaces:**
- Consumes: `Input` from `@/components/ui/input` (existing; `React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>`, default classes include `w-full`); `cn` from `@/lib/utils`.
- Produces: `FormattedNumberInput` (forwardRef, with `integer` mode), `FormattedNumberInputProps`, `sanitizeNumberText(raw, integer?)`, `groupNumberText`, `formatNumberValue` (signatures in "Interfaces" above). P4 applies it (see "Hand-off to P4"): customer demand `input-customer-demand-{id}` (base, `CustomerTable.tsx:163-173`, today `type="number"`, per-keystroke commit, empty → `null`), added scalar demand, JADE per-product demand, all with `suffix="Units"`; station demand (base + added) with `integer`.

- [ ] **Step 0: Invoke the simplicity skills**

Skill tool: `andrej-karpathy-skills:karpathy-guidelines`, then `ponytail:ponytail`. Record in the report that both ran.

- [ ] **Step 1: Write the failing test**

Create `artifacts/studio/src/__tests__/FormattedNumberInput.test.tsx`:

```tsx
import { describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  FormattedNumberInput,
  formatNumberValue,
  groupNumberText,
  sanitizeNumberText,
} from "@/components/data-table/FormattedNumberInput";

// A controlled harness: the parent stores what onChange reports, exactly like
// a demand-override handler would. Like today's demand inputs
// (CustomerTable.tsx:163-173) it passes NO aria-label — the user decided
// (2026-10-17) that none is added.
function Harness({
  initial = null as number | null,
  onValue = (_: number | null) => {},
  disabled = false,
  integer = false,
}) {
  const [value, setValue] = useState<number | null>(initial);
  return (
    <FormattedNumberInput
      value={value}
      onChange={v => {
        setValue(v);
        onValue(v);
      }}
      suffix="Units"
      disabled={disabled}
      integer={integer}
      data-testid="input-customer-demand-C1"
    />
  );
}

const input = () => screen.getByTestId("input-customer-demand-C1") as HTMLInputElement;

describe("pure helpers", () => {
  it("sanitizeNumberText strips commas and spaces, rejects everything else", () => {
    expect(sanitizeNumberText("1, 234 567")).toBe("1234567");
    expect(sanitizeNumberText("12.5")).toBe("12.5");
    expect(sanitizeNumberText("-5")).toBeNull();
    expect(sanitizeNumberText("1e3")).toBeNull();
    expect(sanitizeNumberText("1.2.3")).toBeNull();
    expect(sanitizeNumberText("12a")).toBeNull();
  });

  it("groupNumberText groups the integer part and normalises leading zeros", () => {
    expect(groupNumberText("1234567.891")).toBe("1,234,567.891");
    expect(groupNumberText("0012")).toBe("12");
    expect(groupNumberText("000")).toBe("0");
    expect(groupNumberText("00.50")).toBe("0.50");
    expect(groupNumberText(".")).toBe("0.");
    expect(groupNumberText("")).toBe("");
  });

  it("formatNumberValue renders en-US grouping, null as empty", () => {
    expect(formatNumberValue(1234.5)).toBe("1,234.5");
    expect(formatNumberValue(0)).toBe("0");
    expect(formatNumberValue(null)).toBe("");
  });
});

describe("FormattedNumberInput", () => {
  it("is a text input with decimal inputMode and links the visible 'Units' suffix via aria-describedby", () => {
    render(<Harness initial={1234} />);
    const el = input();
    expect(el).toHaveAttribute("type", "text");
    expect(el).toHaveAttribute("inputmode", "decimal");
    expect(el.value).toBe("1,234");
    const suffix = screen.getByText("Units");
    expect(el.getAttribute("aria-describedby")).toBe(suffix.id);
    expect(el).not.toContainElement(suffix);
  });

  it("adds no aria-label: a consumer without one (today's demand cells) stays without one", () => {
    render(<Harness initial={1} />);
    expect(input()).not.toHaveAttribute("aria-label");
  });

  it("a consumer's own aria-describedby is kept alongside the suffix id", () => {
    render(<FormattedNumberInput value={1} onChange={() => {}} suffix="Units" aria-describedby="hint" data-testid="x" />);
    const ids = (screen.getByTestId("x").getAttribute("aria-describedby") ?? "").split(" ");
    expect(ids[0]).toBe("hint");
    expect(ids[1]).toBe(screen.getByText("Units").id);
  });

  it("integer mode (station demand): numeric inputMode, '.' rejected, digits accepted", async () => {
    const onValue = vi.fn();
    const user = userEvent.setup();
    render(<Harness integer onValue={onValue} />);
    expect(input()).toHaveAttribute("inputmode", "numeric");
    await user.type(input(), "12.5");
    expect(input().value).toBe("125");
    expect(onValue).toHaveBeenLastCalledWith(125);
    expect(sanitizeNumberText("1.5", true)).toBeNull();
    expect(sanitizeNumberText("1,500", true)).toBe("1500");
  });

  it("reformats live on each keystroke and reports numbers", async () => {
    const onValue = vi.fn();
    const user = userEvent.setup();
    render(<Harness onValue={onValue} />);
    await user.type(input(), "1234");
    expect(input().value).toBe("1,234");
    expect(onValue.mock.calls.map(c => c[0])).toEqual([1, 12, 123, 1234]);
  });

  it("allows decimals; a trailing '.' keeps the text without a duplicate onChange", async () => {
    const onValue = vi.fn();
    const user = userEvent.setup();
    render(<Harness onValue={onValue} />);
    await user.type(input(), "1234.5");
    expect(input().value).toBe("1,234.5");
    expect(onValue.mock.calls.map(c => c[0])).toEqual([1, 12, 123, 1234, 1234.5]);
  });

  it("keeps the caret on the same digit when a comma is inserted mid-number", async () => {
    const user = userEvent.setup();
    render(<Harness initial={1234} />);
    // "1,|234" → type 9 → "19,234" with the caret after the 9: "19|,234"
    await user.type(input(), "9", { initialSelectionStart: 2, initialSelectionEnd: 2 });
    expect(input().value).toBe("19,234");
    expect(input().selectionStart).toBe(2);
  });

  it("paste strips grouping commas and spaces", async () => {
    const onValue = vi.fn();
    const user = userEvent.setup();
    render(<Harness onValue={onValue} />);
    await user.click(input());
    await user.paste("1, 234 567");
    expect(input().value).toBe("1,234,567");
    expect(onValue).toHaveBeenLastCalledWith(1234567);
  });

  it("paste with any other character is rejected — text and value unchanged", async () => {
    const onValue = vi.fn();
    const user = userEvent.setup();
    render(<Harness initial={50} onValue={onValue} />);
    await user.click(input());
    await user.paste("12a");
    expect(input().value).toBe("50");
    expect(onValue).not.toHaveBeenCalled();
  });

  it("negatives are rejected", async () => {
    const onValue = vi.fn();
    const user = userEvent.setup();
    render(<Harness onValue={onValue} />);
    await user.type(input(), "-");
    expect(input().value).toBe("");
    expect(onValue).not.toHaveBeenCalled();
  });

  it("empty → null (clears the override)", async () => {
    const onValue = vi.fn();
    const user = userEvent.setup();
    render(<Harness initial={7} onValue={onValue} />);
    await user.clear(input());
    expect(input().value).toBe("");
    expect(onValue).toHaveBeenLastCalledWith(null);
  });

  it("select-all + type replaces the value", async () => {
    const onValue = vi.fn();
    const user = userEvent.setup();
    render(<Harness initial={1234} onValue={onValue} />);
    await user.tripleClick(input());
    await user.keyboard("5");
    expect(input().value).toBe("5");
    expect(onValue).toHaveBeenLastCalledWith(5);
  });

  it("leading zeros are normalised", async () => {
    const onValue = vi.fn();
    const user = userEvent.setup();
    render(<Harness onValue={onValue} />);
    await user.type(input(), "007");
    expect(input().value).toBe("7");
    expect(onValue).toHaveBeenLastCalledWith(7);
  });

  it("values above Number.MAX_SAFE_INTEGER are rejected", () => {
    const onValue = vi.fn();
    render(<Harness initial={1} onValue={onValue} />);
    fireEvent.change(input(), { target: { value: String(Number.MAX_SAFE_INTEGER) } });
    expect(onValue).toHaveBeenLastCalledWith(Number.MAX_SAFE_INTEGER);
    fireEvent.change(input(), { target: { value: "9007199254740992" } });
    expect(onValue).toHaveBeenCalledTimes(1);
    expect(input().value).toBe("9,007,199,254,740,991");
  });

  it("IME: no reformat or onChange during composition; formats on compositionend", () => {
    const onValue = vi.fn();
    render(<Harness onValue={onValue} />);
    fireEvent.compositionStart(input());
    fireEvent.change(input(), { target: { value: "1234" } });
    expect(input().value).toBe("1234");
    expect(onValue).not.toHaveBeenCalled();
    fireEvent.compositionEnd(input());
    expect(input().value).toBe("1,234");
    expect(onValue).toHaveBeenLastCalledWith(1234);
  });

  it("an external value change resyncs the text", () => {
    const { rerender } = render(<FormattedNumberInput value={10} onChange={() => {}} data-testid="x" />);
    rerender(<FormattedNumberInput value={2500} onChange={() => {}} data-testid="x" />);
    expect((screen.getByTestId("x") as HTMLInputElement).value).toBe("2,500");
    rerender(<FormattedNumberInput value={null} onChange={() => {}} data-testid="x" />);
    expect((screen.getByTestId("x") as HTMLInputElement).value).toBe("");
  });

  it("disabled passes through (history read-only / Brazil base lock are the caller's flag)", () => {
    render(<Harness initial={5} disabled />);
    expect(input()).toBeDisabled();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter studio exec vitest run src/__tests__/FormattedNumberInput.test.tsx`
Expected: FAIL — `Error: Failed to resolve import "@/components/data-table/FormattedNumberInput" from "src/__tests__/FormattedNumberInput.test.tsx". Does the file exist?`

- [ ] **Step 3: Write the component**

Create `artifacts/studio/src/components/data-table/FormattedNumberInput.tsx`:

```tsx
// SCU-2.P1 (spec B2.9) — a non-negative decimal input that shows en-US
// grouping ("1,234.5") and reformats on every keystroke, keeping the caret
// on the same significant character (digits + "."). Emits
// `onChange(number | null)`: null = empty = clear override (D3).
//
// Rejected input (anything but digits, one ".", grouping commas/spaces —
// so also "-" and exponents) and values above Number.MAX_SAFE_INTEGER leave
// the field and the value unchanged. IME composition is passed through raw
// and only formatted on `compositionend`. A visible suffix (e.g. "Units")
// sits OUTSIDE the input and is linked via aria-describedby. The component
// never adds an aria-label: whatever accessible name the caller gives the
// input today (none, for the demand cells) is passed through unchanged.
// `integer` (station demand) also rejects ".".

import * as React from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export interface FormattedNumberInputProps
  extends Omit<React.ComponentProps<"input">, "value" | "defaultValue" | "onChange" | "type" | "inputMode"> {
  value: number | null;
  onChange: (value: number | null) => void;
  /** Visible text after the input, e.g. "Units". */
  suffix?: string;
  /** Integers only (station demand): "." is rejected like any other non-digit; inputMode "numeric". */
  integer?: boolean;
  "data-testid"?: string;
}

const isSig = (ch: string) => (ch >= "0" && ch <= "9") || ch === ".";

/** Strips grouping commas and spaces; returns null when anything else is invalid
 * (with `integer`, a "." is invalid too). */
export function sanitizeNumberText(raw: string, integer = false): string | null {
  const s = raw.replace(/[,\s]/g, "");
  if (!(integer ? /^\d*$/ : /^\d*\.?\d*$/).test(s)) return null;
  return s;
}

/** "0012.50" → "12.50", "." → "0.", "" → "" (no grouping). */
function normalize(s: string): string {
  if (s === "") return "";
  const dot = s.indexOf(".");
  const int = (dot < 0 ? s : s.slice(0, dot)).replace(/^0+(?=\d)/, "");
  const frac = dot < 0 ? null : s.slice(dot + 1);
  return frac === null ? int : `${int === "" ? "0" : int}.${frac}`;
}

/** Groups the integer part of a normalized string: "1234.50" → "1,234.50". */
export function groupNumberText(s: string): string {
  const n = normalize(s);
  const dot = n.indexOf(".");
  const int = dot < 0 ? n : n.slice(0, dot);
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return dot < 0 ? grouped : `${grouped}${n.slice(dot)}`;
}

export function formatNumberValue(value: number | null): string {
  return value === null ? "" : value.toLocaleString("en-US", { maximumFractionDigits: 20 });
}

function parse(s: string): number | null {
  return s === "" ? null : Number(s === "." ? "0" : s);
}

function caretAfterSig(text: string, n: number): number {
  if (n <= 0) return 0;
  let seen = 0;
  for (let i = 0; i < text.length; i++) {
    if (isSig(text[i]) && ++seen === n) return i + 1;
  }
  return text.length;
}

export const FormattedNumberInput = React.forwardRef<HTMLInputElement, FormattedNumberInputProps>(
  function FormattedNumberInput(
    { value, onChange, suffix, integer = false, className, onCompositionStart, onCompositionEnd, ...rest },
    forwardedRef,
  ) {
    const innerRef = React.useRef<HTMLInputElement | null>(null);
    const composing = React.useRef(false);
    const pendingCaret = React.useRef<number | null>(null);
    const suffixId = React.useId();
    const [text, setText] = React.useState(() => formatNumberValue(value));
    const [seenValue, setSeenValue] = React.useState(value);

    // External value change (scenario switch, import, reset): resync unless the
    // current text already means that value (e.g. "12." while typing 12.5).
    if (value !== seenValue) {
      setSeenValue(value);
      const current = sanitizeNumberText(text, integer);
      if (current === null || parse(current) !== value) setText(formatNumberValue(value));
    }

    React.useLayoutEffect(() => {
      const el = innerRef.current;
      if (el && pendingCaret.current !== null && document.activeElement === el) {
        el.setSelectionRange(pendingCaret.current, pendingCaret.current);
      }
      pendingCaret.current = null;
    });

    const accept = (raw: string, caret: number) => {
      const clean = sanitizeNumberText(raw, integer);
      const next = clean === null ? null : parse(clean);
      // Rejected: no state change, so React restores the controlled value to `text`.
      if (clean === null || (next !== null && next > Number.MAX_SAFE_INTEGER)) return;
      let sig = 0;
      for (let i = 0; i < caret && i < raw.length; i++) if (isSig(raw[i])) sig++;
      const formatted = groupNumberText(clean);
      pendingCaret.current = caretAfterSig(formatted, sig);
      setText(formatted);
      if (next !== value) {
        setSeenValue(next);
        onChange(next);
      }
    };

    const describedBy = [rest["aria-describedby"], suffix ? suffixId : undefined].filter(Boolean).join(" ") || undefined;

    return (
      <span className="inline-flex items-center gap-1 w-full">
        <Input
          {...rest}
          ref={el => {
            innerRef.current = el;
            if (typeof forwardedRef === "function") forwardedRef(el);
            else if (forwardedRef) forwardedRef.current = el;
          }}
          type="text"
          inputMode={integer ? "numeric" : "decimal"}
          value={text}
          aria-describedby={describedBy}
          className={cn("w-full", className)}
          onChange={e => {
            const raw = e.target.value;
            if (composing.current) {
              setText(raw);
              return;
            }
            accept(raw, e.target.selectionStart ?? raw.length);
          }}
          onCompositionStart={e => {
            composing.current = true;
            onCompositionStart?.(e);
          }}
          onCompositionEnd={e => {
            composing.current = false;
            const el = e.currentTarget;
            accept(el.value, el.selectionStart ?? el.value.length);
            onCompositionEnd?.(e);
          }}
        />
        {suffix && (
          <span id={suffixId} className="text-xs text-muted-foreground whitespace-nowrap">
            {suffix}
          </span>
        )}
      </span>
    );
  },
);
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm --filter studio exec vitest run src/__tests__/FormattedNumberInput.test.tsx`
Expected: PASS — 20 tests (measured at plan time). Coverage map to B2.9's list: caret mid-number ✓, paste ✓ (strip + reject), empty → null ✓, decimals ✓, max-safe ✓, IME ✓, select-all + type ✓, leading zeros ✓, negatives ✓, integer mode ✓, **no aria-label added** + "Units" suffix linked via `aria-describedby` (merged with a consumer's own) ✓, `disabled` pass-through ✓. Brazil base locked vs added editable, history disabled for base/added/JADE, and empty demand blocking the add-customer submit → P4 (deviation 10).

- [ ] **Step 5: e2e sweep**

New files only. `git diff --name-only HEAD -- artifacts/studio/e2e` → empty. Record `e2e: n/a (no UI change)`.

- [ ] **Step 6: Gate**

Run each separately:
1. `cnt=$(ps aux | grep "[v]itest" | grep -v "zsh -c" | wc -l | tr -d ' '); [ "$cnt" = "0" ]`
2. `pnpm run typecheck`
3. `pnpm --filter studio typecheck:e2e`
4. `DATABASE_URL="postgresql://shubhamkr@localhost:5432/nos_dev" pnpm --filter api-server test`
5. `pnpm --filter studio test`
6. `(cd artifacts/api-server/src/solver && python3 -m pytest tests/ -x)`

Expected: every command exits 0.

- [ ] **Step 7: Changelog**

Append to the bottom of `docs/CHANGELOG-implementation.md`:

```markdown

### SCU-2.P1.6 — FormattedNumberInput

- `components/data-table/FormattedNumberInput.tsx`: text/decimal input, en-US grouping live, caret kept by significant-character count, paste strip/reject, IME-safe, leading zeros normalised, > MAX_SAFE_INTEGER and negatives rejected, `onChange(number | null)` (null = clear override, D3), "Units" suffix outside the input via aria-describedby, no aria-label added, `integer` mode for station demand.
- Deviations 10 (table-level B2.9 tests move to P4), 11 (onChange only when the number changes), 12 (no aria-label, user decision 2026-10-17).
- Gate: studio <N passed>, api-server <N passed>, pytest <N passed>. e2e: n/a (no UI change).
```

- [ ] **Step 8: Commit**

```bash
git add artifacts/studio/src/components/data-table/FormattedNumberInput.tsx artifacts/studio/src/__tests__/FormattedNumberInput.test.tsx
```

```bash
[ "$(git rev-parse --abbrev-ref HEAD)" != "main" ] || exit 1
```

```bash
git commit artifacts/studio/src/components/data-table/FormattedNumberInput.tsx artifacts/studio/src/__tests__/FormattedNumberInput.test.tsx docs/CHANGELOG-implementation.md -m "[SCU-2.P1.6] add FormattedNumberInput" -m "Deviations 10, 11, 12; integer mode for station demand; no consumer yet (applied in P4)." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Phase P1 exit (controller, after P1.6 is cherry-picked)

- [ ] `git log --oneline <P1 base>..scnd-upgrades` shows exactly six `[SCU-2.P1.N]` commits, N = 1…6, on top of the L0 Bundle 1 merge; `git merge-base --is-ancestor "$B1_TIP" scnd-upgrades` succeeds.
- [ ] `git diff --stat <P1 base>..scnd-upgrades -- artifacts/studio/e2e artifacts/studio/src/pages artifacts/studio/src/components/workspace lib artifacts/api-server` → empty (P1 has no consumers and no server change).
- [ ] Re-run the full gate on the bundle tip (each command separately, with the vitest-quiet check first).
- [ ] Hand P2/P3/P4 plan authors: this plan's "Interfaces" section, the "Hand-off to P4" section below and matrix §4–§5.
- [ ] No `/harness-retro`, merge, push or deploy here: the branch finishes after P4 (root CLAUDE.md branch pipeline).

## Hand-off to P4 (and P3) — obligations P1 deliberately leaves to the consumer phases

- **Real-browser focus check (Codex finding 6).** P1 proves in jsdom only that the focus jump selects the right page and calls `scrollIntoView`; jsdom has no layout (`artifacts/studio/CLAUDE.md`, "A test that cannot fail…"). The P4 Distances and JadeDistances migration commits each add a Playwright check: trigger the post-Save precheck "jump to it" on a target on page ≥ 2 with a filter active, then assert the filter was cleared, the page indicator shows the target's page, and the target row is **in the viewport** (`await expect(row).toBeInViewport()`).
- **B2.9 application (spec rev 4, user decisions 2026-10-17).**
  - Customer demand — base `input-customer-demand-{id}`, added `input-added-customer-demand-{id}`, JADE `input-customer-demand-{c}-{p}` / `input-added-customer-demand-{id}-{p}` — uses `FormattedNumberInput` with `suffix="Units"`; testids unchanged.
  - **No aria-label is added** anywhere; the P4 RTL tests assert the demand inputs still have none and that `aria-describedby` points at the "Units" suffix.
  - **Station demand** (`input-station-demand-{id}`, `input-added-station-demand-{id}`) uses `FormattedNumberInput` with `integer` (today `parseInt`, `StationTable.tsx:50-62`).
  - **The add-customer form blocks submit when a demand field is empty** (scalar already does, `CustomersTab.tsx:348-351`; the JADE per-product blank→0 at `:330-333` changes), with a validation message, in the inline form and in the B2.8 modal.
  - Still to ask the user in P4: what emptying an existing **added** row's demand cell means (today it commits `0`, `CustomersTab.tsx:547-557`; the component reports `null`).
  - P4 carries the table-level B2.9 tests: Brazil base locked vs added editable; history disabled for base, added and JADE; empty demand blocks add-customer submit.
  - e2e that reads demand with `Number(...)` must be rewritten in that commit (matrix §5 item 9).
- **JADE Plants** base + added share ONE filter menu (spec rev 4 B2.2); the `id` column's `value()` covers both accessors (`name ?? id`, `displayCode ?? id`).
- **`ctx`** is required: every input adapter passes the live history flag as `readOnly` (D2 — matrix §5 item 8 lists the tabs that have no disabled prop today); output adapters pass `{ readOnly: true, demandEditable: false }`.
- **Filter-type pins and ids** (matrix §5 items 3–5): column ids equal today's descriptor keys; pin `filter` where auto-derivation would change today's control type.

## Self-review (run at plan time)

- **Spec coverage (rev 4).** B2.1 props → P1.2 (types, required `ctx`) + P1.4 (render) — rendering rules (primitives, `table-auto`, `px-3 py-1.5`, `whitespace-nowrap`, number centring, no fixed widths) asserted in `DataTable.test.tsx` "markup"; `readOnly` reaching every cell → P1.4. B2.2 pipeline / filter precedence / null handling with the internal empty token / descriptor ids / shared menu / trigger testid → P1.2 + P1.4; paging fixed at 50, pager > 50, rev 4 reset rule (all six cases), clamp, added rows appended → P1.3 + P1.4; focus jump (rev 4 wording) → P1.4, browser check → P4 hand-off; From/To removal → proven in P1.5 (actual removal per table in P4). B2.9 component bullets incl. integer mode and no-aria-label → P1.6; table-level B2.9 tests → P4 hand-off. B2.10 matrix → P1.1 (every reference regenerated at `B1_TIP`). B2.3–B2.8 → P2/P4 (toolbar slots exist in P1.4).
- **Codex deep review (11 findings) folded:** 1 topology + L0 + `B1_TIP` base guard; 2 P1.1 remaps every reference (scripts); 3 FilterMenu append starts after line 116 with no stray `});`, re-run; 4 `pageResetKey` + six DataTable reset tests + key-order tests; 5 spec B2.2 amended; 6 P4 browser check; 7 complete scoped sets + built-in breaks; 8 matrix row #9; 9 internal empty token; 10 no aria-label, tests assert absence + describedby; 11 no page-size override, `ctx` required.
- **Placeholder scan.** The only `<…>` tokens are changelog values the task must measure (rule: measured or `unknown`), `B1_TIP`/`BASE` (set by L0 / the topology commands) and the worktree index `N`.
- **Type consistency.** Every name in the tasks (`ColumnDef`, `CellContext`, `DataTableContext`, `DataTableTestIds`, `DataTableSection`, `DataTableFocus`, `DataTableProps`, `deriveFilterDescriptors`, `FILTER_ROW_THRESHOLD`, `SELECT_DISTINCT_MAX`, `EMPTY_FILTER_VALUE`, `EMPTY_FILTER_LABEL`, `PAGE_SIZE`, `pageResetKey`, `usePagedRows`, `PagedRows`, `TablePager`, `TablePagerTestIds`, `FormattedNumberInput`, `sanitizeNumberText`, `groupNumberText`, `formatNumberValue`, `triggerTestId`) matches the code blocks, which were compiled with `tsc -p artifacts/studio/tsconfig.json --noEmit` (exit 0, which also proves the `@ts-expect-error` is consumed) and run under vitest — 104 tests across the six test files (11 + 15 + 12 + 36 + 10 + 20; the 35th is the `downloadAlign` test folded in with the P3 review, the 36th the same-ids-new-columns test folded in with the P4 Codex review), all passing, plus `ImportDialog.test.tsx` 10, `DistancesTab.test.tsx` 64 and `useTableFilters.test.ts` 16 unchanged and green — in a scratch copy of `artifacts/studio` at `46d2f98` before this plan was written. The three P1.1 scripts were run against the matrix at plan time (identity remap byte-exact; checker 152 rows / 10 legitimate mismatches; inventory reproduces §3).
