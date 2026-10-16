# SCND Upgrades — Bundle 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. At execution start, seed a TaskCreate entry per task **and** per process gate (gate run, `e2e_accuracy.py`, e2e sweep, changelog entry, finishing skill, `/harness-retro`), per the standing ledger rule.

**Goal:** Ship Bundle 1 of the SCND upgrades spec (B1.1–B1.9): exclusive service-band rows in Service Stats and Compare, a Solution Summary bar with a Compare toggle and a compare-mode CSV, duplicate output-tab titles removed, inline Save for `delivery-teaching-us` and `max-coverage-us`, a sidebar that starts expanded and collapses on Run Optimizer, a right-aligned homepage feedback launcher, opaque Output Map tooltips, an Output Map narrative, and the `Plant Capability Matrix` rename.

**Architecture:** Everything is presentation-layer. Two pure band helpers go into `@workspace/units` (`computeExclusiveBandCoverage` for live edges, `frozenBandCoverageToExclusive` for a solved result's frozen `metrics.bandCoverage`). They sit beside the existing classifier `assignBandOrOverflow` and share one round-plus-residual rule. Studio-only knowledge goes into `artifacts/studio/src/lib/`: which models store exclusive frozen coverage, per-model precision, range labels, the narrative builder and the compare CSV builder. Components only consume these helpers. There is no change to `solve.py`, the server, the OpenAPI contract, the DB schema or generated code.

**Tech Stack:** pnpm monorepo; React 18 + Vite + TypeScript in `artifacts/studio`; vitest + React Testing Library; Playwright e2e in `artifacts/studio/e2e`; `@workspace/units` in `lib/units` (vitest); react-leaflet for the maps.

**Spec (source of truth):** `docs/superpowers/specs/2026-10-16-scnd-upgrades-design.md` (revision 2), section "Bundle 1", plus decisions D5 and D6. Bundle 2 (B2.x) is out of scope for this plan.

## Global Constraints

- **Workdir / branch:** bundle branch `scnd-upgrades` in `/Users/shubhamkr/nos-scnd-upgrades`. Never touch `/Users/shubhamkr/network-optimization-studio`. Each task runs in its own pre-created locked worktree (see "Execution topology"). The task's first Bash command is `cd <its worktree> && git rev-parse --abbrev-ref HEAD`, and it must print `scu-1.N-work`; otherwise STOP.
- **Before every `git commit`:** `[ "$(git rev-parse --abbrev-ref HEAD)" != "main" ] || exit 1`. Run it alone, read its output, then commit **with an explicit pathspec** (`git commit <paths> -m …`). Never pipe a state-changing git command.
- **One task = one commit.** Message `[SCU-1.N] <imperative summary>`; the body ends with the line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Changelog in the same commit (hard rule #9).** SCU-1.1 appends the heading `## SCU-B1 — SCND upgrades Bundle 1 (2026-10-16 spec)` at the bottom of `docs/CHANGELOG-implementation.md`. Every later task appends its own `### SCU-1.N — <title>` subsection. Numbers are measured in that task's own run; anything that cannot be derived is the literal string `unknown`. A cherry-pick conflict that is purely two bottom-appended changelog blocks is resolved by keeping both, in task-id order.
- **Hard rule #12:** each engineering task (frontend-engineer) starts with Step 0: invoke `andrej-karpathy-skills:karpathy-guidelines`, then `ponytail:ponytail`, via the Skill tool, and say in the report that both ran. qa-sdet (SCU-1.10) is exempt. Engineering reviews: latest Opus + `ponytail:ponytail-review`. The qa-sdet review is a separate `fable` reviewer (AGENTS.md).
- **Never edit generated code** (`lib/api-zod/src/generated/`, `lib/api-client-react/src/generated/`). This bundle needs no OpenAPI change. If a task appears to need one, STOP and escalate.
- **`solve.py` and the server are untouched** (spec B1.9 "Untouched"). `e2e_accuracy.py` is sacred: run it unmodified after SCU-1.2 (`cd artifacts/api-server/src/solver/tests && python3 e2e_accuracy.py`). It must exit 0 with no `FAIL` line.
- **D5:** a stale Output Map shows no narrative. The parent gate `if (!hasFreshSolvedRun) return <StaleOutputBanner …/>` (`Workspace.tsx:3934-3936`) is kept unchanged.
- **D6:** the legacy `computeBandCoverage` (`artifacts/studio/src/lib/bands.ts:88-101`, still called by `pages/Studio.tsx:36,1751`) and the server's `computeCumulativeBandCoverage` stay unchanged.
- **Spec values, verbatim:**
  - Band semantics: band 0 = `0 ≤ d ≤ b[0]`; band *i* = `b[i-1] < d ≤ b[i]`; overflow = `d > b[max]`. Classification is always `assignBandOrOverflow`.
  - Rows: one per sorted boundary, **plus an overflow row, always**. Total flow 0 → every row 0. Round to `decimals`, then add the residual `100 − Σ` to the row with the largest positive share (ties go to the lowest band). A 0 row never receives the residual.
  - `decimals`: `delivery-teaching-us` 2, every other model 0.
  - Labels: `0–200 mi`, `200–400 mi`, `> 1600 mi` (en dash U+2013, unit-aware).
  - Test ids: `output-map-narrative`, `button-toggle-compare`, `button-save` (preserved), `cost-summary-compare-toggle-{id}` (preserved), `button-toggle-sidebar` (preserved).
  - Compare CSV: first column `metric`, then one column per compared scenario in on-screen order with the scenario name as header. Raw values. A missing value is an empty cell. Units go in the metric label. Filename `cost-summary-compare.csv`.
  - Tooltip class `nos-map-tooltip`; rule `.leaflet-tooltip.nos-map-tooltip`.
  - Sidebar label `Plant Capability Matrix`.
  - Feedback launcher: right edge within 32 px of the viewport's right edge; bottom above the `DeveloperCredit` top.
- **Gate (every task, verbatim from the spec; `typecheck:e2e` verified to exist at `artifacts/studio/package.json:11`):**
  `pnpm run typecheck && pnpm --filter studio typecheck:e2e && pnpm --filter api-server test && pnpm --filter studio test && (cd artifacts/api-server/src/solver && python3 -m pytest tests/ -x)`
  SCU-1.1 additionally runs `pnpm --filter @workspace/units test`, because `lib/units` tests are not part of the repo gate. Run each command separately and judge it by its own exit status. Before trusting a full suite, run `cnt=$(ps aux | grep "[v]itest" | grep -v "zsh -c" | wc -l | tr -d ' '); [ "$cnt" = "0" ]` alone. Never chain that check with `&&`.
- **Flakes:** before calling a failure a regression, check `docs/superpowers/flake-registry.md` by test **name** and re-run the failing file twice in isolation. Record any new sighting there.
- **e2e:** every task greps `artifacts/studio/e2e/` for each testid or visible string it changes and rewrites the sibling specs in the same commit (standing gotcha). When the local two-server setup is up, run the touched specs with `E2E_BASE_URL=http://localhost:<studio-port>`. When it is not, record `e2e: not run — deferred to SCU-1.10` in the changelog entry. Never claim green. The full `pnpm e2e:gate` runs once, in SCU-1.10.
- **Local DB:** `DATABASE_URL="postgresql://shubhamkr@localhost:5432/nos_dev"` inline on each command that needs it. `nos_dev` is shared with other sessions.
- **No merge, no push, no deploy in this plan.** Bundle 2 continues on this same branch (see SCU-1.11).
- **Line numbers are from `46d2f98` (pre-task state).** Earlier tasks shift them, so locate by the quoted text, verify it, then edit.

## Spec deviations and grounding facts (read before any task)

These come from reading the code at `46d2f98` and from running `solve.py` locally. Each one is the smallest correct reading of the repo where the spec text and the code disagree (hard rule #8). Every commit that implements one names it in its body.

1. **JADE's frozen `bandCoverage` is already EXCLUSIVE, not cumulative.** `solve_jade` buckets each outbound lane once (`_band_exclusive`, `solve.py:1320-1327`; `band_flow[distance_bands[band_idx]] += …`, `solve.py:1381-1385`). A local run of `test_jade.GROUND_TRUTH_INPUTS` with bands `[200,400,800,1200]` returned `[{200:21},{400:12},{800:31},{1200:25},{-1:12}]`, which sums to 101 and is non-monotonic. Every other model's frozen coverage is cumulative: `solve.py:497-501` p-median, `:670-673` transport, `:863-868` brazil, `:1052-1076` gold-au, `:1633` max-coverage, `:1842-1845` delivery. The spec's single `cumulativeToExclusive` would mis-difference JADE. **Plan:** `frozenBandCoverageToExclusive(bandCoverage, decimals, shape)` with `shape: "cumulative" | "exclusive"`, plus a studio map `frozenBandShape(modelId)` that returns `"exclusive"` for `two-echelon-jade-us` only. The spec's cumulative algorithm is the `"cumulative"` branch, unchanged.
2. **Narrative open-facility fields.** `two-echelon-gold-au` emits **no** `metrics.openFacilityIds`; its open refineries are `details.openWarehouseIds` (`solve.py:1081-1090`, `open_ids` = refineries at `:1011`). JADE's `metrics.openFacilityIds` holds **warehouses only** (`open_ids` at `solve.py:1316`, emitted at `:1418`). Plants are not decisions. **Plan:** the two-echelon adapter reads `metrics.openFacilityIds ?? details.openWarehouseIds`, uses the noun "refinery/refineries" for gold-au and "warehouse(s)" for JADE, and never calls plants "open".
3. **Narrative signature.** The spec's `buildResultNarrative(modelId, result, unit)` has no way to get the band lens, the solve time or display ids. **Plan:** `buildResultNarrative(modelId, result, ctx)` with `ctx = { bands, distance, solveTimeSec?, displayIdById? }`. Per spec, bands are the same lens the map colours with (`effectiveBands`, `OutputMapTab.tsx:208`) and the solve time is the overlay's `timing.totalSec` (`OutputMapTab.tsx:441-446`).
4. **"Overflow row, always" changes existing e2e.** `nonjade-servicestats-live-coverage.spec.ts:233,353,436` assert `service-stats-band--1` has count 0. They are rewritten to assert the row reads `0%` (SCU-1.2).
5. **Compare "shared bands"** now compares real boundaries only (the `-1` row is dropped in `bandBoundaries`, `CostSummaryTab.tsx:150-152`). Without this, two delivery scenarios with identical boundaries would count as "different bands" whenever only one of them had overflow, and the bands note would print a `-1` boundary.
6. **No boundaries means no rows.** `computeExclusiveBandCoverage(edges, [], d)` returns `[]`, which matches `computeCumulativeBandCoverage` (`bands.ts:53`). Service Stats then keeps its existing `service-stats-no-bands` message.
7. **B1.8 has no e2e text to update.** `workspace-fixups.spec.ts:246-283` addresses the tab only by testid (`sidebar-input-capability-matrix`). `grep -rn "Capability Matrix" artifacts/studio/e2e` matches only comments and a test title. The label gets a unit assertion instead (`Workspace.Jade.test.tsx:149-152`).
8. **B1.2:** after the change, no caller passes `showInlineSave={false}`, so the prop is **deleted** (`InputMapTab.tsx:160-169,765,1052`; `Workspace.tsx:3424-3431`) rather than set to `true`.
9. **B1.3 auto-open:** `selectedIds` is initialised to `[scenarioId]` (`CostSummaryTab.tsx:269`), so "2+ already selected" is false at every mount today. The rule is implemented literally as the picker's lazy initial state, `useState(() => selectedIds.length >= 2)`. The commit body records that it is unreachable today.
10. **B1.5 changes the default from collapsed to expanded.** Specs that hover the collapsed rail's `button-open-scenarios-flyout` therefore change: `two-echelon.spec.ts:135`, `empty-first-run-workspace.spec.ts:61-69,161`, and `sidebar-rail.spec.ts` (whole file).
11. **The compare CSV `Objective` is the solver's raw `result.objective`** (canonical units). The on-screen cell may be unit-formatted by `formatObjective`. The spec says "raw numbers", so the CSV takes the stored value. Distance-bearing rows are exported in the active **display** unit, and their label names that unit, because the label must state the unit the number is in.

## File Structure

| Path | Change | Task |
|---|---|---|
| `lib/units/src/bands.ts` | add `FrozenBandShape`, private `withResidual`, `computeExclusiveBandCoverage`, `frozenBandCoverageToExclusive` | 1.1 |
| `lib/units/src/__tests__/bands.test.ts` | tests for both helpers | 1.1 |
| `artifacts/studio/src/lib/bands.ts` | re-export both helpers; add `bandDecimals`, `frozenBandShape`, `exclusiveBandLabels` | 1.1 |
| `artifacts/studio/src/__tests__/bandsSingleSource.test.ts` | reference-identity + classifier pin for the new helpers | 1.1 |
| `artifacts/studio/src/__tests__/exclusiveBands.test.ts` | **new** — studio helper tests | 1.1 |
| `artifacts/studio/src/components/workspace/tabs/ServiceStatsTab.tsx` | exclusive rows + range labels (1.2); title removed (1.4) | 1.2, 1.4 |
| `artifacts/studio/src/components/workspace/tabs/CostSummaryTab.tsx` | exclusive compare band rows (1.2); bar, picker toggle, compare row model, compare CSV (1.3) | 1.2, 1.3 |
| `artifacts/studio/src/__tests__/ServiceStatsTab.test.tsx`, `CostSummaryTab.test.tsx` | rewritten expectations | 1.2, 1.3, 1.4 |
| `artifacts/studio/e2e/delivery-teaching.spec.ts`, `nonjade-servicestats-live-coverage.spec.ts` | exclusive values / overflow-always | 1.2 |
| `artifacts/studio/src/lib/clientCsv.ts` | **new** — `csvCell`, `downloadTextFile`, `downloadClientCsv` (moved out of `JadeFlowsTab.tsx:184-203`) | 1.3 |
| `artifacts/studio/src/lib/compareCsv.ts` + `__tests__/compareCsv.test.ts` | **new** — `buildCompareCsv` | 1.3 |
| `artifacts/studio/src/components/workspace/tabs/JadeFlowsTab.tsx` | import the moved CSV helpers (1.3); drop the tab-level title (1.4) | 1.3, 1.4 |
| e2e: `two-echelon`, `bundle6-ui-tweaks`, `jade-transport-costs`, `workspace-ux-r1-r9` | open the picker first | 1.3 |
| `OpenWarehousesTab.tsx`, `AssignmentsTab.tsx`, `JadeAssignmentsTab.tsx`, `FlowsTab.tsx` (+ their tests, `JadeFlowsTab.test.tsx`) | duplicate title removed | 1.4 |
| `artifacts/studio/src/pages/Workspace.tsx` | label rename (1.4); Save gates (1.5); sidebar state (1.6) | 1.4, 1.5, 1.6 |
| `artifacts/studio/src/__tests__/Workspace.Jade.test.tsx` | label assertion | 1.4 |
| `artifacts/studio/src/components/workspace/tabs/InputMapTab.tsx` | Save no longer gated on `fixedGeography`; `showInlineSave` deleted | 1.5 |
| `InputMapTab.deliveryFixedGeography.test.tsx`, `Workspace.test.tsx` | Save placement tests | 1.5, 1.6 |
| e2e: `max-coverage.spec.ts`, `delivery-teaching.spec.ts` | Save scoped to `pmedian-map-toolbar` | 1.5 |
| `artifacts/studio/src/components/workspace/SidebarTree.tsx` + `__tests__/SidebarTree.test.tsx` | controlled `collapsed`; localStorage removed | 1.6 |
| e2e: `sidebar-rail.spec.ts`, `two-echelon.spec.ts`, `empty-first-run-workspace.spec.ts` | expanded-on-load contract | 1.6 |
| `artifacts/studio/src/components/FeedbackWidget.tsx` + test, `e2e/feedback.spec.ts` | right-aligned launcher and panel | 1.7 |
| `artifacts/studio/src/index.css`, `components/NetworkMap.tsx`, `__tests__/NetworkMap.test.tsx` | `nos-map-tooltip` | 1.8 |
| `artifacts/studio/src/lib/resultNarrative.ts` + `__tests__/resultNarrative.test.ts` | **new** — per-family narrative | 1.9 |
| `artifacts/studio/src/components/workspace/tabs/OutputMapNarrative.tsx` | **new** — renders the narrative | 1.9 |
| `artifacts/studio/src/components/workspace/tabs/OutputMapTab.tsx` + test | mount the narrative; `legLabel` moves to `resultNarrative.ts` | 1.9 |
| `docs/CHANGELOG-implementation.md` | one subsection per task | all |
| `docs/superpowers/flake-registry.md` | new sightings only | 1.10 |

## Execution topology (dependencies and parallel worktrees)

Dependency graph:

- **SCU-1.1** blocks **SCU-1.2** and **SCU-1.9** (both consume the band helpers and labels).
- **SCU-1.2** blocks **SCU-1.3** (both rewrite `CostSummaryTab.tsx`'s compare body) and **SCU-1.4** (both edit `ServiceStatsTab.tsx:287-299`, adjacent hunks).
- **SCU-1.5, 1.6, 1.7, 1.8** depend on nothing in this plan.
- **SCU-1.10** runs after 1.1–1.9 are on the bundle branch. **SCU-1.11** runs last.

Waves. A task inside a wave can run in parallel with every other task in that wave:

| Wave | Tasks | Base |
|---|---|---|
| A | 1.1, 1.5, 1.6, 1.7, 1.8 | `scnd-upgrades` tip at dispatch |
| B | 1.2, 1.9 | tip after wave A is cherry-picked |
| C | 1.3, 1.4 | tip after wave B is cherry-picked |
| D | 1.10 (qa-sdet) | tip after wave C |
| E | 1.11 (lead) | tip after 1.10 |

Shared files inside one wave touch disjoint hunks: `Workspace.tsx` (1.5 at `:2336-2379,3404-3431`; 1.6 at `:2839-2888,4373-4395`); `Workspace.test.tsx` (1.5 rewrites two existing tests; 1.6 appends a new `describe` at EOF); `JadeFlowsTab.tsx` (1.3 at `:1-12,184-203`; 1.4 at `:396`).

**Do NOT rely on `isolation: "worktree"`** (root CLAUDE.md gotcha). For each task the controller pre-creates a locked worktree from the wave's base:

```bash
BASE=$(git -C /Users/shubhamkr/nos-scnd-upgrades rev-parse scnd-upgrades)
git -C /Users/shubhamkr/nos-scnd-upgrades worktree add --lock /Users/shubhamkr/nos-scu-1.N -b scu-1.N-work "$BASE"
```

```bash
cd /Users/shubhamkr/nos-scu-1.N && pnpm install --frozen-lockfile
```

A fresh worktree has no `node_modules`. When this plan was written, `/Users/shubhamkr/nos-scnd-upgrades` had none, and `pnpm --filter @workspace/units exec vitest …` failed with `Command "vitest" not found`. So every worktree, and the bundle worktree before its own gate runs, needs the install first.

The controller dispatches **without** `isolation`. The agent's first Bash command is `cd /Users/shubhamkr/nos-scu-1.N && git rev-parse --abbrev-ref HEAD` (it must print `scu-1.N-work`), then `git merge-base --is-ancestor "$BASE" HEAD` as the base guard. The controller cherry-picks each task commit onto `scnd-upgrades` in task-id order, then re-runs the gate on the bundle branch before it starts the next wave.

---
## Task SCU-1.1: Exclusive band helpers (B1.9 helpers)

**Owner role:** frontend-engineer. **Spec:** B1.9 "Semantics", "Live helper", "Compare helper". **Deviations:** 1, 6.

**Files:**
- Modify: `lib/units/src/bands.ts` (append after line 68; nothing existing changes)
- Test: `lib/units/src/__tests__/bands.test.ts` (import block lines 2-5; append at EOF, after line 79)
- Modify: `artifacts/studio/src/lib/bands.ts:24-45` (import/re-export block) and append at EOF (after line 123)
- Test: `artifacts/studio/src/__tests__/bandsSingleSource.test.ts:15` (extend `it.each`) and append a test
- Create: `artifacts/studio/src/__tests__/exclusiveBands.test.ts`
- Modify: `docs/CHANGELOG-implementation.md` (append section heading + `### SCU-1.1`)

**Interfaces:**
- Consumes: `assignBandOrOverflow(distance: number, bands: number[]): number`, `OVERFLOW_BAND = -1`, `BandEdge`, `BandCoverageEntry` (all `lib/units/src/bands.ts:1-25`).
- Produces (in `@workspace/units`, re-exported unchanged from `@/lib/bands`):
  - `type FrozenBandShape = "cumulative" | "exclusive"`
  - `computeExclusiveBandCoverage(edges: BandEdge[], bands: number[], decimals?: number): BandCoverageEntry[]`. Returns `[]` when `bands` is empty. Otherwise one row `{ band: <boundary>, percent }` per sorted boundary, then `{ band: OVERFLOW_BAND, percent }`.
  - `frozenBandCoverageToExclusive(bandCoverage: BandCoverageEntry[] | null | undefined, decimals: number, shape: FrozenBandShape): BandCoverageEntry[] | null`. Returns `null` when no real boundary row exists. Otherwise it returns the same row shape as above.
- Produces (studio-only, `@/lib/bands`):
  - `bandDecimals(modelId: string | undefined): number`. Returns `2` for `delivery-teaching-us`, else `0`.
  - `frozenBandShape(modelId: string | undefined): FrozenBandShape`. Returns `"exclusive"` for `two-echelon-jade-us`, else `"cumulative"`.
  - `exclusiveBandLabels(boundaries: number[], format: (canonical: number) => string, unit: string): string[]`. Returns `boundaries.length + 1` labels aligned with the rows above, e.g. `["0–200 mi", "200–400 mi", "> 400 mi"]`, or `[]` when there are no boundaries.

**Why the helpers live in `@workspace/units` and the model map lives in the studio:** the round-plus-residual rule must be identical for live edges and for frozen coverage, and both must classify through `assignBandOrOverflow`. Keeping the private `withResidual` beside that classifier in one file makes divergence impossible and lets `bandsSingleSource.test.ts` pin it by reference identity. Which models store exclusive frozen data is a fact about `solve.py`'s output that only the studio consumes. The server export keeps `computeCumulativeBandCoverage` (B1.9 "Untouched"), so that map belongs in `artifacts/studio/src/lib/bands.ts`, next to the existing studio-only helpers.

- [ ] **Step 0: Invoke the simplicity skills**

Skill tool: `andrej-karpathy-skills:karpathy-guidelines`, then `ponytail:ponytail`. Record in the report that both ran.

- [ ] **Step 1: Write the failing `@workspace/units` tests**

In `lib/units/src/__tests__/bands.test.ts`, replace the import block (lines 2-5):

```ts
import {
  OVERFLOW_BAND, assignBandOrOverflow, bandLabelOrOverflow,
  computeCumulativeBandCoverage, serviceEdgesFor,
} from "../bands.js";
```

with:

```ts
import {
  OVERFLOW_BAND, assignBandOrOverflow, bandLabelOrOverflow,
  computeCumulativeBandCoverage, computeExclusiveBandCoverage,
  frozenBandCoverageToExclusive, serviceEdgesFor,
} from "../bands.js";
```

Append at EOF:

```ts
// SCU-1.1 (spec B1.9) — EXCLUSIVE rows: band 0 = 0 <= d <= b0, band i =
// b(i-1) < d <= b(i), overflow = d > b(max). Always one row per boundary
// plus an overflow row; rounded to `decimals`, residual to the largest
// positive share (ties -> lowest band). Every expected value below was
// computed by running the algorithm, not by eye.
describe("computeExclusiveBandCoverage", () => {
  const pct = (rows: { percent: number }[]) => rows.map(r => r.percent);

  it("a zero-distance edge lands in band 0", () => {
    expect(computeExclusiveBandCoverage([{ distance: 0, flow: 5 }], BANDS, 0)).toEqual([
      { band: 200, percent: 100 }, { band: 400, percent: 0 }, { band: 800, percent: 0 }, { band: OVERFLOW_BAND, percent: 0 },
    ]);
  });

  it("a distance exactly on a boundary lands in the LOWER band", () => {
    const rows = computeExclusiveBandCoverage([{ distance: 200, flow: 1 }, { distance: 400, flow: 1 }], BANDS, 0);
    expect(pct(rows)).toEqual([50, 50, 0, 0]);
  });

  it("always ends with an overflow row, even at 0%", () => {
    const rows = computeExclusiveBandCoverage([{ distance: 100, flow: 1 }], BANDS, 0);
    expect(rows).toHaveLength(BANDS.length + 1);
    expect(rows.at(-1)).toEqual({ band: OVERFLOW_BAND, percent: 0 });
  });

  it("counts flow beyond the last boundary in the overflow row only", () => {
    const rows = computeExclusiveBandCoverage([{ distance: 100, flow: 1 }, { distance: 900, flow: 3 }], BANDS, 0);
    expect(pct(rows)).toEqual([25, 0, 0, 75]);
  });

  it("integer rounding: the residual makes the rows sum to exactly 100, given to the largest share (ties -> lowest band)", () => {
    const edges = [{ distance: 100, flow: 1 }, { distance: 300, flow: 1 }, { distance: 700, flow: 1 }];
    expect(pct(computeExclusiveBandCoverage(edges, BANDS, 0))).toEqual([34, 33, 33, 0]);
  });

  it("2-dp rounding: the residual makes the rows sum to 100", () => {
    const edges = [{ distance: 100, flow: 1 }, { distance: 300, flow: 1 }, { distance: 700, flow: 1 }];
    const rows = computeExclusiveBandCoverage(edges, BANDS, 2);
    expect(pct(rows)).toEqual([33.34, 33.33, 33.33, 0]);
    expect(rows.reduce((s, r) => s + r.percent, 0)).toBeCloseTo(100, 9);
  });

  it("a 0% row never receives the residual", () => {
    const edges = [{ distance: 100, flow: 1 }, { distance: 300, flow: 1 }, { distance: 900, flow: 1 }];
    expect(pct(computeExclusiveBandCoverage(edges, BANDS, 0))).toEqual([34, 33, 0, 33]);
  });

  it("all-zero flow -> every row 0, no residual applied", () => {
    const rows = computeExclusiveBandCoverage([{ distance: 100, flow: 0 }, { distance: 900, flow: 0 }], BANDS, 0);
    expect(pct(rows)).toEqual([0, 0, 0, 0]);
  });

  it("no boundaries -> no rows (same as computeCumulativeBandCoverage)", () => {
    expect(computeExclusiveBandCoverage([{ distance: 10, flow: 1 }], [], 0)).toEqual([]);
  });

  it("sorts unsorted boundaries", () => {
    const rows = computeExclusiveBandCoverage([{ distance: 300, flow: 1 }], [800, 200, 400], 0);
    expect(rows.map(r => r.band)).toEqual([200, 400, 800, OVERFLOW_BAND]);
    expect(pct(rows)).toEqual([0, 100, 0, 0]);
  });
});

// SCU-1.1 (spec B1.9 "Compare helper", deviation 1) — frozen
// `metrics.bandCoverage` -> exclusive rows. Fixture shapes follow solve.py:
// p-median :497-501 (cumulative, integer, no -1 row); delivery :1842-1845
// (cumulative, 2 dp, explicit -1 row); JADE :1320-1327/:1381-1385/:1401-1406
// (EXCLUSIVE, integer, explicit -1 row — values from a real local run of
// test_jade.GROUND_TRUTH_INPUTS with bands [200,400,800,1200]); max-coverage
// :1633 (two-row [highService, 100%]).
describe("frozenBandCoverageToExclusive", () => {
  const pct = (rows: { percent: number }[] | null) => rows?.map(r => r.percent);

  it("absent, empty, or overflow-only coverage -> null", () => {
    expect(frozenBandCoverageToExclusive(undefined, 0, "cumulative")).toBeNull();
    expect(frozenBandCoverageToExclusive(null, 0, "cumulative")).toBeNull();
    expect(frozenBandCoverageToExclusive([], 0, "cumulative")).toBeNull();
    expect(frozenBandCoverageToExclusive([{ band: OVERFLOW_BAND, percent: 100 }], 0, "cumulative")).toBeNull();
  });

  it("p-median integer cumulative -> exclusive, overflow = 100 - last", () => {
    const rows = frozenBandCoverageToExclusive(
      [{ band: 200, percent: 40 }, { band: 400, percent: 80 }, { band: 800, percent: 95 }, { band: 1600, percent: 100 }], 0, "cumulative");
    expect(rows).toEqual([
      { band: 200, percent: 40 }, { band: 400, percent: 40 }, { band: 800, percent: 15 },
      { band: 1600, percent: 5 }, { band: OVERFLOW_BAND, percent: 0 },
    ]);
  });

  it("delivery 2-dp cumulative with an explicit -1 row: the -1 row is dropped before differencing, never a boundary", () => {
    const rows = frozenBandCoverageToExclusive([
      { band: 400, percent: 59.38 }, { band: 800, percent: 81.45 }, { band: 1200, percent: 99.44 },
      { band: 1600, percent: 99.8 }, { band: OVERFLOW_BAND, percent: 0.2 },
    ], 2, "cumulative");
    expect(rows).toEqual([
      { band: 400, percent: 59.38 }, { band: 800, percent: 22.07 }, { band: 1200, percent: 17.99 },
      { band: 1600, percent: 0.36 }, { band: OVERFLOW_BAND, percent: 0.2 },
    ]);
  });

  it("JADE frozen coverage is ALREADY exclusive: kept as-is, explicit -1 is the overflow, residual fixes the 101", () => {
    const rows = frozenBandCoverageToExclusive([
      { band: 200, percent: 21 }, { band: 400, percent: 12 }, { band: 800, percent: 31 },
      { band: 1200, percent: 25 }, { band: OVERFLOW_BAND, percent: 12 },
    ], 0, "exclusive");
    expect(pct(rows)).toEqual([21, 12, 30, 25, 12]);
  });

  it("exclusive shape without a -1 row has a 0% overflow row", () => {
    expect(pct(frozenBandCoverageToExclusive([{ band: 200, percent: 60 }, { band: 400, percent: 40 }], 0, "exclusive")))
      .toEqual([60, 40, 0]);
  });

  it("max-coverage's two-row [highService, 100%] shape works through the cumulative path", () => {
    expect(frozenBandCoverageToExclusive([{ band: 450, percent: 66.6667 }, { band: 3400, percent: 100 }], 0, "cumulative"))
      .toEqual([{ band: 450, percent: 67 }, { band: 3400, percent: 33 }, { band: OVERFLOW_BAND, percent: 0 }]);
  });

  it("non-monotonic rounded cumulative data clamps negative differences to 0", () => {
    expect(pct(frozenBandCoverageToExclusive([{ band: 200, percent: 50 }, { band: 400, percent: 49 }], 0, "cumulative")))
      .toEqual([50, 0, 50]);
  });

  it("sorts rows by boundary before differencing", () => {
    expect(frozenBandCoverageToExclusive([{ band: 400, percent: 80 }, { band: 200, percent: 40 }], 0, "cumulative"))
      .toEqual([{ band: 200, percent: 40 }, { band: 400, percent: 40 }, { band: OVERFLOW_BAND, percent: 20 }]);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm --filter @workspace/units exec vitest run src/__tests__/bands.test.ts`
Expected: FAIL. The new `describe` blocks error with `TypeError: computeExclusiveBandCoverage is not a function` (and the same for `frozenBandCoverageToExclusive`). The pre-existing tests still pass.

- [ ] **Step 3: Implement in `lib/units/src/bands.ts`** (append after line 68)

```ts

// SCU-1.1 (spec B1.9) — the two EXCLUSIVE helpers. `computeCumulativeBandCoverage`
// above is unchanged: the server's exports still use it.
export type FrozenBandShape = "cumulative" | "exclusive";

/** Round each share to `decimals`, then give `100 - sum` to the row with the
 *  largest positive RAW share (ties -> lowest index). A 0 row never receives
 *  it, and an all-zero input gets no residual at all. */
function withResidual(keys: number[], raw: number[], decimals: number): BandCoverageEntry[] {
  const rounded = raw.map(p => roundTo(p, decimals));
  let target = -1;
  raw.forEach((p, i) => {
    if (p > 0 && (target === -1 || p > raw[target])) target = i;
  });
  if (target !== -1) {
    const residual = 100 - rounded.reduce((s, p) => s + p, 0);
    rounded[target] = roundTo(rounded[target] + residual, decimals);
  }
  return keys.map((band, i) => ({ band, percent: rounded[i] }));
}

/**
 * EXCLUSIVE rollup from live edges: one row per sorted boundary (keyed by the
 * boundary value) plus an OVERFLOW_BAND row, always. Every edge is classified
 * by `assignBandOrOverflow`, so these rows always agree with map colours and
 * table cells. `[]` when there are no boundaries.
 */
export function computeExclusiveBandCoverage(edges: BandEdge[], bands: number[], decimals = 0): BandCoverageEntry[] {
  const sorted = [...bands].sort((a, b) => a - b);
  if (sorted.length === 0) return [];
  const flows = new Array<number>(sorted.length + 1).fill(0);
  for (const e of edges) {
    const i = assignBandOrOverflow(e.distance, sorted);
    flows[i === OVERFLOW_BAND ? sorted.length : i] += e.flow;
  }
  const keys = [...sorted, OVERFLOW_BAND];
  const total = flows.reduce((s, f) => s + f, 0);
  if (total === 0) return keys.map(band => ({ band, percent: 0 }));
  return withResidual(keys, flows.map(f => (f * 100) / total), decimals);
}

/**
 * A solved result's frozen `metrics.bandCoverage` -> the same exclusive rows.
 * `-1` rows are never boundaries. "cumulative" (every model except JADE):
 * exclusive[i] = cum[i] - cum[i-1], clamped at 0; overflow = max(0, 100 -
 * cum[last]). "exclusive" (JADE, solve.py:1320-1327): rows are kept; the
 * explicit -1 row, if any, is the overflow (else 0). Then the same round +
 * residual rule. `null` when there is no real boundary row.
 */
export function frozenBandCoverageToExclusive(
  bandCoverage: BandCoverageEntry[] | null | undefined,
  decimals: number,
  shape: FrozenBandShape,
): BandCoverageEntry[] | null {
  const all = bandCoverage ?? [];
  const rows = all.filter(r => r.band !== OVERFLOW_BAND).sort((a, b) => a.band - b.band);
  if (rows.length === 0) return null;
  const keys = [...rows.map(r => r.band), OVERFLOW_BAND];
  let raw: number[];
  if (shape === "cumulative") {
    raw = rows.map((r, i) => Math.max(0, r.percent - (i === 0 ? 0 : rows[i - 1].percent)));
    raw.push(Math.max(0, 100 - rows[rows.length - 1].percent));
  } else {
    raw = rows.map(r => Math.max(0, r.percent));
    const overflow = all.find(r => r.band === OVERFLOW_BAND);
    raw.push(overflow ? Math.max(0, overflow.percent) : 0);
  }
  return withResidual(keys, raw, decimals);
}
```

`lib/units/src/index.ts` already does `export * from "./bands.js";`, so no index edit is needed.

- [ ] **Step 4: Run them to verify they pass**

Run: `pnpm --filter @workspace/units exec vitest run src/__tests__/bands.test.ts`
Expected: PASS (every test in the file, old and new).

- [ ] **Step 5: Write the failing studio tests**

In `artifacts/studio/src/__tests__/bandsSingleSource.test.ts`, replace line 15:

```ts
  it.each(["OVERFLOW_BAND", "assignBandOrOverflow", "computeCumulativeBandCoverage", "serviceEdgesFor"])(
```

with:

```ts
  it.each([
    "OVERFLOW_BAND", "assignBandOrOverflow", "computeCumulativeBandCoverage", "serviceEdgesFor",
    "computeExclusiveBandCoverage", "frozenBandCoverageToExclusive",
  ])(
```

Then append, inside the same `describe` (before its closing `});`):

```ts

  // SCU-1.1 (spec B1.9) — pins the exclusive helper to the shared classifier
  // BEHAVIOURALLY: a single edge's whole flow must land in exactly the row
  // assignBandOrOverflow names, at every boundary edge case.
  it("computeExclusiveBandCoverage buckets every distance exactly where assignBandOrOverflow does", () => {
    const bands = [200, 400, 800];
    for (const d of [0, 1, 199.9999, 200, 200.0001, 400, 799, 800, 800.0001, 5000]) {
      const rows = sharedUnits.computeExclusiveBandCoverage([{ distance: d, flow: 7 }], bands, 0);
      const idx = sharedUnits.assignBandOrOverflow(d, bands);
      const expectedRow = idx === sharedUnits.OVERFLOW_BAND ? rows.length - 1 : idx;
      rows.forEach((r, i) => expect(r.percent, `distance ${d}, row ${i}`).toBe(i === expectedRow ? 100 : 0));
    }
  });
```

Create `artifacts/studio/src/__tests__/exclusiveBands.test.ts`:

```ts
// SCU-1.1 (spec B1.9) — studio-only band helpers: range labels, per-model
// precision, and which models store EXCLUSIVE frozen coverage (deviation 1:
// solve.py's JADE path buckets each lane once, solve.py:1320-1327/:1381-1385;
// every other model's frozen bandCoverage is cumulative).
import { describe, it, expect } from "vitest";
import { bandDecimals, exclusiveBandLabels, frozenBandShape } from "@/lib/bands";

describe("exclusiveBandLabels", () => {
  const fmt = (v: number) => String(v);

  it("labels each exclusive row with its range and the overflow row with '>' (en dash, unit-aware)", () => {
    expect(exclusiveBandLabels([200, 400, 800, 1600], fmt, "mi")).toEqual([
      "0–200 mi", "200–400 mi", "400–800 mi", "800–1600 mi", "> 1600 mi",
    ]);
  });

  it("sorts boundaries", () => {
    expect(exclusiveBandLabels([400, 200], fmt, "mi")).toEqual(["0–200 mi", "200–400 mi", "> 400 mi"]);
  });

  it("routes every boundary through the caller's formatter (unit conversion lives there)", () => {
    expect(exclusiveBandLabels([600], v => (v / 1.609344).toFixed(4), "mi")).toEqual(["0–372.8227 mi", "> 372.8227 mi"]);
  });

  it("no boundaries -> no labels", () => {
    expect(exclusiveBandLabels([], fmt, "mi")).toEqual([]);
  });
});

describe("bandDecimals", () => {
  it("delivery-teaching-us keeps its 2-dp precision; every other model is integer", () => {
    expect(bandDecimals("delivery-teaching-us")).toBe(2);
    for (const id of ["p-median-us", "p-median-brazil", "transport-coal", "max-coverage-us", "two-echelon-gold-au", "two-echelon-jade-us", undefined]) {
      expect(bandDecimals(id)).toBe(0);
    }
  });
});

describe("frozenBandShape", () => {
  it("JADE alone stores exclusive frozen coverage", () => {
    expect(frozenBandShape("two-echelon-jade-us")).toBe("exclusive");
    for (const id of ["p-median-us", "p-median-brazil", "transport-coal", "max-coverage-us", "two-echelon-gold-au", "delivery-teaching-us", undefined]) {
      expect(frozenBandShape(id)).toBe("cumulative");
    }
  });
});
```

- [ ] **Step 6: Run them to verify they fail**

Run: `pnpm --filter studio exec vitest run src/__tests__/bandsSingleSource.test.ts src/__tests__/exclusiveBands.test.ts`
Expected: FAIL. `bandsSingleSource` fails `expected undefined to be [Function computeExclusiveBandCoverage]` for the two new names. `exclusiveBands` fails `exclusiveBandLabels is not a function` (and likewise for `bandDecimals` and `frozenBandShape`).

- [ ] **Step 7: Implement in `artifacts/studio/src/lib/bands.ts`**

Replace lines 24-45 (the `import { … } from "@workspace/units";` block through `export { bandLabelOrOverflow as bandLabel };`):

```ts
import {
  OVERFLOW_BAND,
  assignBandOrOverflow,
  computeCumulativeBandCoverage,
  computeExclusiveBandCoverage,
  frozenBandCoverageToExclusive,
  serviceEdgesFor,
  bandLabelOrOverflow,
  type BandEdge,
  type BandCoverageEntry,
  type FrozenBandShape,
} from "@workspace/units";

export {
  OVERFLOW_BAND,
  assignBandOrOverflow,
  computeCumulativeBandCoverage,
  computeExclusiveBandCoverage,
  frozenBandCoverageToExclusive,
  serviceEdgesFor,
  type BandEdge,
  type BandCoverageEntry,
  type FrozenBandShape,
};

// This frontend's established name for the shared label helper.
export { bandLabelOrOverflow as bandLabel };
```

Append at EOF (after line 123):

```ts

// SCU-1.1 (spec B1.9) — band precision per model: delivery-teaching-us
// reports 2 dp (spec §5.7 of its own design); every other model's tests are
// pinned to integers. The single place this rule lives (it used to be inline
// in ServiceStatsTab.tsx).
export function bandDecimals(modelId: string | undefined): number {
  return modelId === "delivery-teaching-us" ? 2 : 0;
}

// SCU-1.1 (deviation 1) — the shape of a solved result's FROZEN
// metrics.bandCoverage, a fact about solve.py's output: JADE buckets each
// outbound lane exactly once (solve.py:1320-1327, :1381-1385); every other
// model accumulates cumulatively (solve.py:497-501, :670-673, :863-868,
// :1052-1076, :1633, :1842-1845).
const EXCLUSIVE_FROZEN_BAND_MODELS: ReadonlySet<string> = new Set(["two-echelon-jade-us"]);

export function frozenBandShape(modelId: string | undefined): FrozenBandShape {
  return modelId != null && EXCLUSIVE_FROZEN_BAND_MODELS.has(modelId) ? "exclusive" : "cumulative";
}

// SCU-1.1 (spec B1.9 "Display") — one label per exclusive row, aligned with
// computeExclusiveBandCoverage / frozenBandCoverageToExclusive output:
// "0–200 mi", "200–400 mi", …, "> 1600 mi". `format` turns a CANONICAL
// boundary into display text (unit conversion is the caller's, via
// useDisplayUnit), `unit` is the display unit label.
export function exclusiveBandLabels(boundaries: number[], format: (canonical: number) => string, unit: string): string[] {
  const sorted = [...boundaries].sort((a, b) => a - b);
  if (sorted.length === 0) return [];
  const labels = sorted.map((b, i) => `${i === 0 ? "0" : format(sorted[i - 1])}–${format(b)} ${unit}`);
  labels.push(`> ${format(sorted[sorted.length - 1])} ${unit}`);
  return labels;
}
```

- [ ] **Step 8: Run them to verify they pass**

Run: `pnpm --filter studio exec vitest run src/__tests__/bandsSingleSource.test.ts src/__tests__/exclusiveBands.test.ts src/__tests__/bands.test.ts`
Expected: PASS (all three files; `bands.test.ts` is unchanged and proves the legacy helpers are untouched, D6).

- [ ] **Step 9: e2e sweep**

This task changes no rendered UI: it adds helpers only and has no consumers yet. No testid or visible string changes, so there is nothing to grep and no spec to rewrite. Record `e2e: n/a (no UI change)` in the changelog.

- [ ] **Step 10: Gate**

Run each separately, judging each by its own exit status:
1. `cnt=$(ps aux | grep "[v]itest" | grep -v "zsh -c" | wc -l | tr -d ' '); [ "$cnt" = "0" ]`
2. `pnpm --filter @workspace/units test`
3. `pnpm run typecheck && pnpm --filter studio typecheck:e2e && pnpm --filter api-server test && pnpm --filter studio test && (cd artifacts/api-server/src/solver && python3 -m pytest tests/ -x)`

Expected: every command exits 0. On any failure, check `docs/superpowers/flake-registry.md` by test name before treating it as a regression.

- [ ] **Step 11: Changelog**

Append to the bottom of `docs/CHANGELOG-implementation.md`:

```markdown

## SCU-B1 — SCND upgrades Bundle 1 (2026-10-16 spec)

Plan: `docs/superpowers/plans/2026-10-17-scnd-upgrades-bundle1.md`. Spec: `docs/superpowers/specs/2026-10-16-scnd-upgrades-design.md` (rev 2), Bundle 1 + D5/D6.

### SCU-1.1 — exclusive band helpers

- `@workspace/units`: `computeExclusiveBandCoverage`, `frozenBandCoverageToExclusive` (+ private `withResidual`); `computeCumulativeBandCoverage` unchanged. Studio `lib/bands.ts`: `bandDecimals`, `frozenBandShape`, `exclusiveBandLabels`; re-exports pinned in `bandsSingleSource.test.ts`.
- Deviation (plan §"Spec deviations" 1): JADE's frozen coverage is exclusive (solve.py:1320-1327, :1381-1385; measured `[21,12,31,25,12]` for bands 200/400/800/1200), so the compare helper takes a `shape` instead of being cumulative-only.
- Gate: units <N passed>, studio <N passed>, api-server <N passed>, pytest <N passed> — measured this run. e2e: n/a (no UI change).
```

Replace each `<N passed>` with the count printed by this task's own gate run, or the literal `unknown`.

- [ ] **Step 12: Commit**

```bash
git add artifacts/studio/src/__tests__/exclusiveBands.test.ts
```

```bash
[ "$(git rev-parse --abbrev-ref HEAD)" != "main" ] || exit 1
```

```bash
git commit lib/units/src/bands.ts lib/units/src/__tests__/bands.test.ts artifacts/studio/src/lib/bands.ts artifacts/studio/src/__tests__/bandsSingleSource.test.ts artifacts/studio/src/__tests__/exclusiveBands.test.ts docs/CHANGELOG-implementation.md -m "[SCU-1.1] add exclusive band coverage helpers" -m "Deviation 1: frozen coverage takes a shape; JADE's frozen bandCoverage is already exclusive (solve.py:1320-1327)." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

(The `git add` comes first because a pathspec commit cannot pick up an untracked file.)

---
## Task SCU-1.2: Exclusive band rows in Service Stats and Compare (B1.9 display)

**Owner role:** frontend-engineer. **Spec:** B1.9 "Display", "Untouched". **Deviations:** 4, 5. **Depends on:** SCU-1.1.

**Files:**
- Modify: `artifacts/studio/src/components/workspace/tabs/ServiceStatsTab.tsx:6` (import), `:282-293` (coverage source), `:319-352` (row rendering)
- Modify: `artifacts/studio/src/components/workspace/tabs/CostSummaryTab.tsx:32-35` (delete `formatBandBoundary`), `:150-152` (`bandBoundaries`), `:751-766` (band rows), plus one import line
- Test: `artifacts/studio/src/__tests__/ServiceStatsTab.test.tsx` (rewrites listed in Step 1)
- Test: `artifacts/studio/src/__tests__/CostSummaryTab.test.tsx:891-897`
- e2e: `artifacts/studio/e2e/delivery-teaching.spec.ts:211,225`; `artifacts/studio/e2e/nonjade-servicestats-live-coverage.spec.ts:169-173,233,252-256,331-337,353,436,458-462`
- Modify: `docs/CHANGELOG-implementation.md`

**Interfaces:**
- Consumes (from SCU-1.1, via `@/lib/bands`): `computeExclusiveBandCoverage(edges, bands, decimals)`, `frozenBandCoverageToExclusive(bandCoverage, decimals, shape)`, `frozenBandShape(modelId)`, `bandDecimals(modelId)`, `exclusiveBandLabels(boundaries, format, unit)`, `OVERFLOW_BAND`.
- Produces: unchanged testids `service-stats-band-${band}` and `cost-summary-compare-band-${band}-${scenarioId}`, where `band` is a boundary value or `-1`. The overflow row (`…-band--1…`) is now **always** rendered when there is at least one boundary. SCU-1.3 rebuilds the compare band rows on its row model with these same ids and labels.

- [ ] **Step 0: Invoke the simplicity skills**

Skill tool: `andrej-karpathy-skills:karpathy-guidelines`, then `ponytail:ponytail`.

- [ ] **Step 1: Rewrite the unit tests to the exclusive contract (they fail now)**

Every expected value below was computed by running the SCU-1.1 algorithm on the fixture. The line numbers quote `46d2f98`, so apply the edits **bottom-up**, (j) first and (a) last, so that each quoted number is still valid when you reach it.

In `artifacts/studio/src/__tests__/ServiceStatsTab.test.tsx`:

(a) After the `render` helper (after line 21), add:

```ts
// SCU-1.2 — the percent cell alone (span #2 of a band row: label, bar div,
// percent). Row text concatenates label + percent ("200–400 mi15%"), so a
// bare toHaveTextContent("0%") would also match "10%"/"100%".
const percentOf = (testId: string) => screen.getByTestId(testId).querySelectorAll("span")[1]?.textContent;
```

(b) Replace the test at lines 69-73 ("renders one bar per band with its exclusive percent") body with:

```ts
    render(<ServiceStatsTab result={result} scenarioId={1} modelId="p-median-us" />);
    // frozen cumulative [200:30, 400:45] -> exclusive 30 / 15 / overflow 55
    expect(percentOf("service-stats-band-200")).toBe("30%");
    expect(percentOf("service-stats-band-400")).toBe("15%");
    expect(percentOf("service-stats-band--1")).toBe("55%");
```

(c) Lines 130 and 135: `toHaveTextContent("≤ 200 mi")` → `toHaveTextContent("0–200 mi")`.

(d) Replace the whole `describe("Chapter 9 JADE — cumulative coverage + explicit overflow row", …)` block (lines 163-198) with:

```ts
  // jade-T14 / SCU-1.2 (deviation 1) — JADE's frozen bandCoverage is
  // EXCLUSIVE (solve.py:1320-1327, :1381-1385). Fixture = a real local run of
  // test_jade.GROUND_TRUTH_INPUTS with bands [200,400,800,1200]: it sums to
  // 101, so the residual rule takes 1 from the largest row (31 -> 30).
  describe("Chapter 9 JADE — exclusive frozen coverage + explicit overflow row", () => {
    const jadeResult = {
      ...result,
      metrics: {
        bandCoverage: [
          { band: 200, percent: 21 },
          { band: 400, percent: 12 },
          { band: 800, percent: 31 },
          { band: 1200, percent: 25 },
          { band: -1, percent: 12 },
        ],
      },
    };

    it("renders the exclusive shares at every boundary (not re-differenced)", () => {
      render(<ServiceStatsTab result={jadeResult} scenarioId={1} modelId="two-echelon-jade-us" />);
      expect(percentOf("service-stats-band-200")).toBe("21%");
      expect(percentOf("service-stats-band-400")).toBe("12%");
      expect(percentOf("service-stats-band-800")).toBe("30%");
      expect(percentOf("service-stats-band-1200")).toBe("25%");
    });

    it("renders a separately labelled '> 1200 mi' overflow row, not folded into the 1200 row", () => {
      render(<ServiceStatsTab result={jadeResult} scenarioId={1} modelId="two-echelon-jade-us" />);
      const overflowRow = screen.getByTestId("service-stats-band--1");
      expect(overflowRow).toHaveTextContent("> 1200 mi");
      expect(percentOf("service-stats-band--1")).toBe("12%");
      expect(screen.getByTestId("service-stats-band-1200")).toHaveTextContent("800–1200 mi");
    });

    it("always renders the overflow row, at 0% when nothing exceeds the last boundary", () => {
      render(<ServiceStatsTab result={{ ...result, metrics: { bandCoverage: [{ band: 200, percent: 30 }, { band: 400, percent: 100 }] } }} scenarioId={1} modelId="p-median-us" />);
      expect(percentOf("service-stats-band--1")).toBe("0%");
    });
  });
```

(e) Line 227: `expect(screen.getByTestId("service-stats-band-5000")).toHaveTextContent("100%");` → `expect(percentOf("service-stats-band-5000")).toBe("34%");`. That fixture is frozen cumulative `[450:66, 5000:100]`, which gives 66 / 34 / 0.

(f) Lines 547-550 and the identical block at 618-621 become:

```ts
      expect(percentOf("service-stats-band-100")).toBe("10%");
      expect(percentOf("service-stats-band-300")).toBe("20%");
      expect(percentOf("service-stats-band-600")).toBe("30%");
      expect(percentOf("service-stats-band-1000")).toBe("0%");
```

Also rename the test title at line 535 from "recomputes cumulative coverage …" to "recomputes exclusive coverage …", and the comment at 505 from "cumulative" to "exclusive". The overflow assertions at 562-564 and 622-624 (`> 1000 mi`, `40%`) are unchanged.

(g) Line 587: `toHaveTextContent("45%")` → replace that line with `expect(percentOf("service-stats-band-400")).toBe("15%");`.

(h) Lines 644-645 become:

```ts
      expect(percentOf("service-stats-band-300")).toBe("90%");
      expect(percentOf("service-stats-band--1")).toBe("0%");
```

(i) Line 731: `expect(screen.getByTestId("service-stats-band-300")).toHaveTextContent("100%");` → `expect(percentOf("service-stats-band-300")).toBe("90%");`.

(j) Lines 793-800. That fixture's frozen `[600:66, -1:15]` is cumulative for `synthetic-km-model`: the `-1` row is dropped, giving 66 / 34. Replace those lines with:

```ts
    expect(screen.getByTestId("service-stats-band-600")).toHaveTextContent("0–372.8227 mi");
    const overflowRow = screen.getByTestId("service-stats-band--1");
    // The overflow row's shown boundary (600, the max REAL boundary) is
    // converted exactly the same way — never the literal sentinel `-1`.
    expect(overflowRow).toHaveTextContent("> 372.8227 mi");
    expect(overflowRow).not.toHaveTextContent("-1");
    expect(percentOf("service-stats-band--1")).toBe("34%");
```

Every other ServiceStatsTab assertion is already true under the exclusive contract. Verified values: `:178` and `:186-188` are replaced by (d); `:221`, `:226` (66%), `:548` (10%), `:563-564`, `:586` (30%), `:592` (30%), `:643` (10%), `:662` (50%), `:673` (100%), `:704-709` (0/0/0/100), `:730` (10%), `:754` (33.33%) and `:766-767` (33%) are unchanged.

In `artifacts/studio/src/__tests__/CostSummaryTab.test.tsx`, replace lines 894-896 with:

```ts
    // frozen cumulative s1 [200:40,400:80] -> 40/40/20; s2 [200:60,400:90] -> 60/30/10
    expect(screen.getByTestId("cost-summary-compare-band-200-1")).toHaveTextContent("40%");
    expect(screen.getByTestId("cost-summary-compare-band-200-2")).toHaveTextContent("60%");
    expect(screen.getByTestId("cost-summary-compare-band-400-1")).toHaveTextContent("40%");
    expect(screen.getByTestId("cost-summary-compare-band-400-2")).toHaveTextContent("30%");
    expect(screen.getByTestId("cost-summary-compare-band--1-1")).toHaveTextContent("20%");
    expect(screen.getByTestId("cost-summary-compare-band--1-2")).toHaveTextContent("10%");
    const labels = ["200", "400", "-1"].map(b => screen.getByTestId(`cost-summary-compare-band-${b}-1`).closest("tr")!.querySelector("td")!.textContent);
    expect(labels).toEqual(["0–200 mi", "200–400 mi", "> 400 mi"]);
    expect(screen.queryByTestId("cost-summary-compare-bands-note")).not.toBeInTheDocument();
```

and rename that test (line 891) to `"shows exclusive per-band coverage rows (plus overflow) when all selected scenarios share identical bands"`.

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm --filter studio exec vitest run src/__tests__/ServiceStatsTab.test.tsx src/__tests__/CostSummaryTab.test.tsx`
Expected: FAIL. For example, `expected '45%' to be '15%'`, `Unable to find an element by: [data-testid="service-stats-band--1"]`, and `expected element to have text content "0–200 mi"` (received `≤ 200 mi…`).

- [ ] **Step 3: Implement — Service Stats**

`ServiceStatsTab.tsx:6`, replace:

```ts
import { computeCumulativeBandCoverage, OVERFLOW_BAND } from "@/lib/bands";
```

with:

```ts
import {
  bandDecimals, computeExclusiveBandCoverage, exclusiveBandLabels,
  frozenBandCoverageToExclusive, frozenBandShape, OVERFLOW_BAND,
} from "@/lib/bands";
```

Replace lines 282-293 (the `// Task 12 (Chapter 5 …` comment through `: (result.metrics.bandCoverage ?? []);`) with:

```ts
  // SCU-1.2 (spec B1.9) — EXCLUSIVE rows (one per boundary + overflow,
  // always). Live: classified from the outbound/service edges by the shared
  // assignBandOrOverflow. Frozen: the solved result's own bandCoverage,
  // converted per its stored shape (JADE is already exclusive — deviation 1).
  // Precision per model lives in bandDecimals (delivery 2 dp, others 0).
  const decimals = bandDecimals(modelId);
  const bandCoverage = useLiveCoverage
    ? computeExclusiveBandCoverage(serviceEdges, presentationBands as number[], decimals)
    : (frozenBandCoverageToExclusive(result.metrics.bandCoverage, decimals, frozenBandShape(modelId)) ?? []);
```

Replace lines 319-352 (the `{/* jade-T14 — model-integration-precheck.md Gate 4 …` comment through the closing `})()}`) with:

```tsx
          {/* jade-T14 / SCU-1.2 — exclusive rows: "0–200 mi", "200–400 mi", …,
              and a `band: -1` overflow row labelled "> {last boundary}". The
              sentinel itself is never converted — only real boundaries go
              through toDisplay (a converted -1 would render "-0.62"). */}
          {(() => {
            const fmt = (v: number) =>
              toDisplay(v, canonicalUnit).toLocaleString(undefined, { maximumFractionDigits: 4, useGrouping: false });
            const labels = exclusiveBandLabels(
              bandCoverage.filter(b => b.band !== OVERFLOW_BAND).map(b => b.band),
              fmt,
              distanceUnit,
            );
            return bandCoverage.map((b, i) => (
              <div key={b.band} data-testid={`service-stats-band-${b.band}`} className="flex items-center gap-2 text-sm">
                <span className="w-28 flex-shrink-0 font-mono">{labels[i]}</span>
                <div className="flex-1 bg-muted rounded h-3 overflow-hidden">
                  <div className="bg-primary h-full" style={{ width: `${Math.min(b.percent, 100)}%` }} />
                </div>
                <span className="w-14 text-right font-mono">{b.percent}%</span>
              </div>
            ));
          })()}
```

The rows are sorted boundaries followed by overflow, which is exactly the order `exclusiveBandLabels` returns. The label column widens from `w-24` to `w-28` to fit `1200–1600 mi`, and the percent column from `w-10` to `w-14` to fit `100.00%`.

- [ ] **Step 4: Implement — Compare band rows**

`CostSummaryTab.tsx`: add after line 11 (`import { TEXTBOOK_TRANSPORT_COSTS, … } from "@/lib/transportCosts";`):

```ts
import { OVERFLOW_BAND, bandDecimals, exclusiveBandLabels, frozenBandCoverageToExclusive, frozenBandShape } from "@/lib/bands";
```

Delete lines 32-35 (`function formatBandBoundary(…) { … }`), which have no caller after this step.

Replace lines 150-152:

```ts
function bandBoundaries(result: SolveResult): number[] {
  return (result.metrics.bandCoverage ?? []).map(b => b.band);
}
```

with:

```ts
// SCU-1.2 (deviation 5) — REAL boundaries only. A `-1` overflow row is not a
// boundary: comparing it would make two scenarios with identical boundaries
// "different" whenever only one had overflow, and print "-1 mi" in the note.
function bandBoundaries(result: SolveResult): number[] {
  return (result.metrics.bandCoverage ?? []).filter(b => b.band !== OVERFLOW_BAND).map(b => b.band);
}
```

Replace lines 751-766 (`{sharedBands &&` through the matching `))}`) with:

```tsx
            {/* SCU-1.2 (spec B1.9) — EXCLUSIVE rows from each column's own
                frozen bandCoverage (converted per its stored shape), plus the
                overflow row. Only rendered when every column shares the same
                real boundaries (scenariosShareBands). */}
            {sharedBands && (() => {
              const boundaries = bandBoundaries(results[0]);
              const fmt = (v: number) =>
                unit.toDisplay(v, canonicalDistanceUnit!).toLocaleString(undefined, { maximumFractionDigits: 4, useGrouping: false });
              const labels = unitLabel == null
                ? [...boundaries, OVERFLOW_BAND].map(() => "—")
                : exclusiveBandLabels(boundaries, fmt, unitLabel);
              const exclusiveByColumn = compareScenarios.map(s =>
                frozenBandCoverageToExclusive(s.result!.metrics.bandCoverage, bandDecimals(modelId), frozenBandShape(modelId)),
              );
              return [...boundaries, OVERFLOW_BAND].map((band, i) => (
                <tr key={band}>
                  <td className="p-2 text-muted-foreground font-mono">{labels[i]}</td>
                  {compareScenarios.map((s, col) => {
                    const coverage = exclusiveByColumn[col]?.find(b => b.band === band);
                    return (
                      <td key={s.id} className="p-2 font-mono" data-testid={`cost-summary-compare-band-${band}-${s.id}`}>
                        {coverage ? `${coverage.percent}%` : "—"}
                      </td>
                    );
                  })}
                </tr>
              ));
            })()}
```

`unitLabel` is non-null exactly when `canonicalDistanceUnit` is non-null (`distanceUnitLabel`, `CostSummaryTab.tsx:44-46`), so `fmt` runs only when the unit is resolved.

- [ ] **Step 5: Run them to verify they pass**

Run: `pnpm --filter studio exec vitest run src/__tests__/ServiceStatsTab.test.tsx src/__tests__/CostSummaryTab.test.tsx src/__tests__/Workspace.test.tsx`
Expected: PASS. `Workspace.test.tsx:3381` (`band-999` 100%) and `:3448-3449` (`band-111` 0%, overflow 100%) still hold under exclusive rows; both were computed (`[100,0]` and `[0,100]`).

- [ ] **Step 6: e2e sweep**

Run these greps now:

```bash
grep -rn "service-stats-band\|cost-summary-compare-band" artifacts/studio/e2e/
grep -rn "≤" artifacts/studio/e2e/
```

At `46d2f98` they find:
- `delivery-teaching.spec.ts:211` (`band-800` `81.45%`) and `:225` (`97.19%`). These are cumulative values and must change.
- `nonjade-servicestats-live-coverage.spec.ts:232-233,248-257,350-353,435-436,454-463`. These cover overflow-absent and Math.round assumptions.
- `chen-bands-units-qa.spec.ts:361`, `workspace-ux-r1-r9.spec.ts:211-220`, `jade-two-echelon.spec.ts:177`, `bundle2-fastfollow.spec.ts:311-312`. These assert only visibility, `> …` or `mi`, so they stay true unchanged.
- The `≤` matches are comments only (`design-system.spec.ts:236`, `workspace-fixups.spec.ts:18,154,338`), so none changes.

Rewrites:

`delivery-teaching.spec.ts`. The values below come from a local `solve_delivery` run fed through the SCU-1.1 algorithm with 2 dp. Scenario 1 is `[59.38, 22.07, 17.99, 0.56, 0]` and scenario 2 is `[26.43, 70.76, 2.81, 0, 0]`.
- line 211: `toContainText("81.45%", …)` → `toContainText("22.07%", …)`
- line 225: `toContainText("97.19%", …)` → `toContainText("70.76%", …)`

`nonjade-servicestats-live-coverage.spec.ts`:
- After `parsePercent` (line 173), add:

```ts
// SCU-1.2 — the exclusive two-row (one boundary + overflow) expectation,
// computed with the SAME rule as computeExclusiveBandCoverage: round each,
// then the residual goes to the larger raw share (ties -> the in-band row).
function expectedTwoRowPercents(inBandFlow: number, overflowFlow: number): [number, number] {
  const total = inBandFlow + overflowFlow;
  const raw = [(inBandFlow * 100) / total, (overflowFlow * 100) / total];
  const rounded = raw.map(Math.round);
  const target = raw[1] > raw[0] ? 1 : 0;
  rounded[target] += 100 - (rounded[0] + rounded[1]);
  return [rounded[0], rounded[1]];
}
```

- Lines 233, 353 and 436 (`await expect(page.getByTestId("service-stats-band--1")).toHaveCount(0);`) each become:

```ts
      // SCU-1.2 — the overflow row is always rendered now; nothing is beyond the last boundary, so it reads 0%.
      expect(parsePercent(await page.getByTestId("service-stats-band--1").innerText())).toBe(0);
```

- Lines 254-255 and 460-461 (the two `Math.round(…)` lines in each block) become:

```ts
      const [expectedInBandPct, expectedOverflowPct] = expectedTwoRowPercents(inBandFlow, overflowFlow);
```

- Fix the stale comments at 228-231, 331-337 and 430-433. They claim the overflow row is omitted when overflow is 0. Replace each with `// SCU-1.2 — the overflow row always renders; 0% here proves no out-of-band flow.`

If the local two-server setup is up (recipe in `artifacts/studio/e2e/CLAUDE.md`), run:
`E2E_BASE_URL=http://localhost:<studio-port> pnpm --filter studio exec playwright test e2e/delivery-teaching.spec.ts e2e/nonjade-servicestats-live-coverage.spec.ts`
Expected: both pass. Otherwise record `e2e: not run — deferred to SCU-1.10`.

- [ ] **Step 7: `e2e_accuracy.py` (sacred, unmodified)**

Run: `cd artifacts/api-server/src/solver/tests && python3 e2e_accuracy.py`
Expected: exit 0, no `FAIL` line. `solve.py` was not touched; this run proves it (spec B1.9 "Untouched").

- [ ] **Step 8: Gate**

Run the vitest-count check, then the global gate, each separately. Every command must exit 0.

- [ ] **Step 9: Changelog**

Append `### SCU-1.2 — exclusive band rows in Service Stats and Compare`. Record: the rows are now exclusive with an always-present overflow row (a behaviour change users will notice, spec "Risks"); deviation 5 (`bandBoundaries` drops `-1`); the rewritten e2e lines with the measured delivery values; the `e2e_accuracy.py` result; and the gate counts from this run.

- [ ] **Step 10: Commit**

```bash
[ "$(git rev-parse --abbrev-ref HEAD)" != "main" ] || exit 1
```

```bash
git commit artifacts/studio/src/components/workspace/tabs/ServiceStatsTab.tsx artifacts/studio/src/components/workspace/tabs/CostSummaryTab.tsx artifacts/studio/src/__tests__/ServiceStatsTab.test.tsx artifacts/studio/src/__tests__/CostSummaryTab.test.tsx artifacts/studio/e2e/delivery-teaching.spec.ts artifacts/studio/e2e/nonjade-servicestats-live-coverage.spec.ts docs/CHANGELOG-implementation.md -m "[SCU-1.2] show exclusive service-band rows in Service Stats and Compare" -m "Deviations 4-5: overflow row always rendered; compare shared-band check ignores the -1 row." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
## Task SCU-1.3: Solution Summary bar, Compare toggle, compare-mode CSV (B1.3)

**Owner role:** frontend-engineer. **Spec:** B1.3. **Deviations:** 9, 11. **Depends on:** SCU-1.2 (same file, compare band rows).

**Files:**
- Create: `artifacts/studio/src/lib/clientCsv.ts` (moves `csvCell` and `downloadClientCsv` out of `JadeFlowsTab.tsx:184-203`, adds `downloadTextFile`)
- Create: `artifacts/studio/src/lib/compareCsv.ts`
- Modify: `artifacts/studio/src/components/workspace/tabs/JadeFlowsTab.tsx:1-12` (import) and `:184-203` (delete the local helpers)
- Modify: `artifacts/studio/src/components/workspace/tabs/CostSummaryTab.tsx`: imports `:1-11`; types after `:128` (`const MAX_COMPARE = 4;`); state after `:269`; `toggleList` `:299-329`; the `!result` branch `:331-339`; the single-mode header `:438-453`; the whole compare branch from `:485` (`// Compare mode: 2-4 solved …`) to the end of the component
- Test: create `artifacts/studio/src/__tests__/compareCsv.test.ts`
- Test: `artifacts/studio/src/__tests__/CostSummaryTab.test.tsx` (helper + sed + three manual edits + a new `describe` at EOF)
- e2e: `two-echelon.spec.ts:173-174`, `bundle6-ui-tweaks.spec.ts:211-212`, `jade-transport-costs.spec.ts:167-168`, `workspace-ux-r1-r9.spec.ts:244-245,286-287`
- Modify: `docs/CHANGELOG-implementation.md`

**Interfaces:**
- Consumes: from SCU-1.1/1.2, `OVERFLOW_BAND`, `bandDecimals`, `exclusiveBandLabels`, `frozenBandCoverageToExclusive`, `frozenBandShape`; and `bandBoundaries(result)` with `-1` excluded (SCU-1.2).
- Produces:
  - `lib/clientCsv.ts`: `csvCell(value: string | number): string`; `downloadTextFile(filename: string, text: string, mimeType: string): void`; `downloadClientCsv(filename: string, headers: string[], rows: (string | number)[][]): void`.
  - `lib/compareCsv.ts`: `interface CompareCsvRow { csvLabel: string; cells: Array<{ raw: number | string | null }> }`; `buildCompareCsv(rows: CompareCsvRow[], scenarios: Array<{ name: string }>): string`. Lines are joined with `\n`.
  - Testids: `button-toggle-compare` (new), `cost-summary-bar` (new), `button-download-cost-summary-csv` (now in **both** modes). Every existing `cost-summary-compare-*` id is unchanged.

- [ ] **Step 0: Invoke the simplicity skills**

Skill tool: `andrej-karpathy-skills:karpathy-guidelines`, then `ponytail:ponytail`.

- [ ] **Step 1: Write the failing `buildCompareCsv` test**

Create `artifacts/studio/src/__tests__/compareCsv.test.ts`:

```ts
// SCU-1.3 (spec B1.3) — the compare-mode CSV writer: `metric` column, then
// one column per compared scenario in on-screen order (header = name); raw
// values; a missing value is an EMPTY cell (the on-screen "—" is
// display-only); rows in the order given (the table's own row model).
import { describe, it, expect } from "vitest";
import { buildCompareCsv } from "@/lib/compareCsv";

describe("buildCompareCsv", () => {
  it("writes a metric column then one column per scenario, in the given order", () => {
    expect(buildCompareCsv(
      [{ csvLabel: "Objective", cells: [{ raw: 100 }, { raw: 120 }] }],
      [{ name: "Baseline" }, { name: "Alt P" }],
    )).toBe("metric,Baseline,Alt P\nObjective,100,120");
  });

  it("renders a missing value (null) as an empty cell, never '—'", () => {
    expect(buildCompareCsv([{ csvLabel: "Inbound cost", cells: [{ raw: null }, { raw: 5 }] }], [{ name: "A" }, { name: "B" }]))
      .toBe("metric,A,B\nInbound cost,,5");
  });

  it("keeps raw numbers unformatted (no thousands separators, full precision)", () => {
    expect(buildCompareCsv([{ csvLabel: "Inbound cost", cells: [{ raw: 1234567.891 }] }], [{ name: "A" }]))
      .toBe("metric,A\nInbound cost,1234567.891");
  });

  it("quotes names and values containing commas or quotes", () => {
    expect(buildCompareCsv([{ csvLabel: "Open facilities", cells: [{ raw: "Chicago, IL" }] }], [{ name: 'Best "3", DCs' }]))
      .toBe('metric,"Best ""3"", DCs"\nOpen facilities,"Chicago, IL"');
  });

  it("mixed optional rows keep row order and column alignment", () => {
    const rows = [
      { csvLabel: "Objective", cells: [{ raw: 1 }, { raw: 2 }, { raw: 3 }] },
      { csvLabel: "Max coverable demand (Model 1)", cells: [{ raw: null }, { raw: 900 }, { raw: null }] },
      { csvLabel: "Quality", cells: [{ raw: "Proven optimal" }, { raw: "No incumbent" }, { raw: "Proven optimal" }] },
    ];
    expect(buildCompareCsv(rows, [{ name: "A" }, { name: "B" }, { name: "C" }])).toBe(
      "metric,A,B,C\nObjective,1,2,3\nMax coverable demand (Model 1),,900,\nQuality,Proven optimal,No incumbent,Proven optimal",
    );
  });
});
```

- [ ] **Step 2: Rewrite and extend `CostSummaryTab.test.tsx` (fails now)**

(a) Add the import after line 3 (`import * as exportEntity from "@/lib/exportEntity";`):

```ts
import * as clientCsv from "@/lib/clientCsv";
```

(b) After the `withModel` function (it ends at line 132), add:

```ts
// SCU-1.3 (spec B1.3) — the scenario picker is HIDDEN by default behind the
// "Compare Scenario" button. Every pre-existing test that reaches a
// `cost-summary-compare-toggle-*` checkbox goes through this: open the picker
// if it is not already open, then return the element.
function compareToggle(testId: string): HTMLElement {
  if (!screen.queryByTestId("cost-summary-compare-toggles")) {
    fireEvent.click(screen.getByTestId("button-toggle-compare"));
  }
  return screen.getByTestId(testId);
}
```

(c) Mechanical rewrite of the 40 direct toggle lookups (count measured with `grep -cE 'screen\.getByTestId\((`|")cost-summary-compare-toggle-' …` → `40`):

```bash
sed -i '' -E 's/screen\.getByTestId\((`|")cost-summary-compare-toggle-/compareToggle(\1cost-summary-compare-toggle-/g' artifacts/studio/src/__tests__/CostSummaryTab.test.tsx
```

Verify: `grep -c 'compareToggle(' artifacts/studio/src/__tests__/CostSummaryTab.test.tsx` → `41` (40 call sites + the definition).

(d) Three manual edits, located by test name:
- "cross-model selection is impossible — scenarios from another model never appear as toggles": before its `expect(screen.queryByTestId("cost-summary-compare-toggle-5"))…` line, insert `fireEvent.click(screen.getByTestId("button-toggle-compare"));`. Without it the assertion would pass vacuously, because the picker is hidden.
- "disables all toggles with a return-to-latest hint while browsing result history": before `expect(screen.getByTestId("cost-summary-history-hint"))…`, insert `fireEvent.click(screen.getByTestId("button-toggle-compare"));`.
- Delete the test "hides Download CSV in compare mode" (5 lines). The new `describe` below replaces it with the opposite contract (spec B1.3: Download CSV in both modes).

(e) Append at EOF:

```tsx
// SCU-1.3 (spec B1.3) — Solution Summary bar: no titles; a primary-green
// "Compare Scenario" button toggles the (hidden by default) picker; Download
// CSV sits right in both modes; compare mode downloads the comparison table,
// built from the same row model the table renders.
describe("Solution Summary bar (SCU-1.3)", () => {
  const s1 = scenario({
    id: 1, name: "Baseline", modelId: "p-median-us",
    result: { ...result, objective: 100, metrics: { weightedAvgDistance: 300, bandCoverage: [{ band: 200, percent: 40 }, { band: 400, percent: 80 }] }, edges: [{ fromId: "WH1", toId: "C1", flow: 1, distance: 100 }, { fromId: "WH2", toId: "C2", flow: 1, distance: 100 }] },
  });
  const s2 = scenario({
    id: 2, name: "Alt P", modelId: "p-median-us",
    result: { ...result, objective: 120, metrics: { weightedAvgDistance: 250, bandCoverage: [{ band: 200, percent: 60 }, { band: 400, percent: 90 }] }, edges: [{ fromId: "WH1", toId: "C1", flow: 1, distance: 100 }] },
  });

  function enterCompare() {
    fireEvent.click(screen.getByTestId("button-toggle-compare"));
    fireEvent.click(screen.getByTestId("cost-summary-compare-toggle-2").querySelector("input")!);
    expect(screen.getByTestId("cost-summary-compare-table")).toBeInTheDocument();
  }

  it("renders no 'Solution Summary' title in either mode", () => {
    renderTab({ scenarios: [s1, s2], modelId: "p-median-us" });
    expect(screen.queryByText(/Solution Summary/)).not.toBeInTheDocument();
    enterCompare();
    expect(screen.queryByText(/Solution Summary/)).not.toBeInTheDocument();
  });

  it("hides the picker by default; the green Compare Scenario button shows and hides it", () => {
    renderTab({ scenarios: [s1, s2], modelId: "p-median-us" });
    const toggle = screen.getByTestId("button-toggle-compare");
    expect(toggle).toHaveTextContent("Compare Scenario");
    expect(toggle.className).toContain("bg-primary"); // Button default variant = the primary green token (index.css --primary)
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByTestId("cost-summary-compare-toggles")).not.toBeInTheDocument();
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByTestId("cost-summary-compare-toggles")).toBeInTheDocument();
    fireEvent.click(toggle);
    expect(screen.queryByTestId("cost-summary-compare-toggles")).not.toBeInTheDocument();
  });

  it("puts the toggle on the left and Download CSV on the right of one bar, in single mode", () => {
    renderTab({ scenarios: [s1, s2], modelId: "p-median-us" });
    const bar = screen.getByTestId("cost-summary-bar");
    expect(bar).toHaveClass("justify-between");
    expect(bar.firstElementChild).toBe(screen.getByTestId("button-toggle-compare"));
    expect(bar.lastElementChild).toBe(screen.getByTestId("button-download-cost-summary-csv"));
  });

  it("in compare mode, Download CSV (right of the bar) downloads the comparison table as cost-summary-compare.csv", () => {
    const spy = vi.spyOn(clientCsv, "downloadTextFile").mockImplementation(() => {});
    renderTab({ scenarios: [s1, s2], modelId: "p-median-us" });
    enterCompare();
    const bar = screen.getByTestId("cost-summary-bar");
    expect(bar.lastElementChild).toBe(screen.getByTestId("button-download-cost-summary-csv"));
    fireEvent.click(screen.getByTestId("button-download-cost-summary-csv"));
    // Raw values, on-screen row order, units in the labels; bands are the
    // exclusive rows (s1 40/40/20, s2 60/30/10).
    expect(spy).toHaveBeenCalledWith("cost-summary-compare.csv", [
      "metric,Baseline,Alt P",
      "Objective,100,120",
      "Weighted avg. distance (mi),300,250",
      "Open facilities,WH1; WH2,WH1",
      "Runtime (s),0.45,0.45",
      "Quality,Proven optimal,Proven optimal",
      "0–200 mi (%),40,60",
      "200–400 mi (%),40,30",
      "> 400 mi (%),20,10",
    ].join("\n"), "text/csv");
    spy.mockRestore();
  });

  it("compare CSV: an optional row one scenario lacks is an empty cell; differing band sets export no band rows", () => {
    const spy = vi.spyOn(clientCsv, "downloadTextFile").mockImplementation(() => {});
    const s2Mixed = scenario({
      ...s2,
      result: { ...s2.result!, metrics: { ...s2.result!.metrics, inboundCost: 5, bandCoverage: [{ band: 500, percent: 60 }] } },
    });
    renderTab({ scenarios: [s1, s2Mixed], modelId: "p-median-us" });
    enterCompare();
    expect(screen.getByTestId("cost-summary-compare-bands-note")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("button-download-cost-summary-csv"));
    expect(spy).toHaveBeenCalledWith("cost-summary-compare.csv", [
      "metric,Baseline,Alt P",
      "Objective,100,120",
      "Inbound cost,,5",
      "Weighted avg. distance (mi),300,250",
      "Open facilities,WH1; WH2,WH1",
      "Runtime (s),0.45,0.45",
      "Quality,Proven optimal,Proven optimal",
    ].join("\n"), "text/csv");
    spy.mockRestore();
  });
});
```

- [ ] **Step 3: Run them to verify they fail**

Run: `pnpm --filter studio exec vitest run src/__tests__/compareCsv.test.ts src/__tests__/CostSummaryTab.test.tsx`
Expected: FAIL. `compareCsv.test.ts` fails with `Failed to resolve import "@/lib/compareCsv"`. `CostSummaryTab.test.tsx` fails with `Failed to resolve import "@/lib/clientCsv"`. Once that resolves, the compare tests fail with `Unable to find an element by: [data-testid="button-toggle-compare"]`.

- [ ] **Step 4: Implement the CSV helpers**

Create `artifacts/studio/src/lib/clientCsv.ts`:

```ts
// Minimal client-side CSV writer + file download, shared by the client-built
// exports (JADE Flows' per-leg tables, Solution Summary compare). Moved out of
// JadeFlowsTab.tsx (SCU-1.3) so there is exactly one copy; behaviour is
// byte-identical (same escaping, same `new Blob([text], { type })`).
export function csvCell(value: string | number): string {
  const s = String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function downloadTextFile(filename: string, text: string, mimeType: string): void {
  const blob = new Blob([text], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function downloadClientCsv(filename: string, headers: string[], rows: (string | number)[][]): void {
  downloadTextFile(filename, [headers, ...rows].map(r => r.map(csvCell).join(",")).join("\n"), "text/csv");
}
```

Create `artifacts/studio/src/lib/compareCsv.ts`:

```ts
import { csvCell } from "@/lib/clientCsv";

// SCU-1.3 (spec B1.3) — Solution Summary compare CSV. `rows` is the compare
// table's OWN row model (CostSummaryTab.tsx), never DOM text: same rows, same
// order. Raw values; `null` (row absent for that scenario) -> empty cell.
export interface CompareCsvRow {
  csvLabel: string;
  cells: Array<{ raw: number | string | null }>;
}

export function buildCompareCsv(rows: CompareCsvRow[], scenarios: Array<{ name: string }>): string {
  const lines = [
    ["metric", ...scenarios.map(s => s.name)],
    ...rows.map(r => [r.csvLabel, ...r.cells.map(c => (c.raw == null ? "" : String(c.raw)))]),
  ];
  return lines.map(line => line.map(csvCell).join(",")).join("\n");
}
```

In `JadeFlowsTab.tsx`, delete lines 184-203 (the `// Minimal client-side CSV writer …` comment, `function csvCell`, and `function downloadClientCsv`). After line 12 (`import type { CanonicalUnit } from "@workspace/units";`), add:

```ts
import { downloadClientCsv } from "@/lib/clientCsv";
```

The two call sites (`:337`, `:345`) are unchanged.

- [ ] **Step 5: Implement the bar, the toggle and the compare row model in `CostSummaryTab.tsx`**

Line 1, replace `import { useState } from "react";` with:

```ts
import { useState, type ReactNode } from "react";
```

After the `@/lib/bands` import that SCU-1.2 added, add:

```ts
import { Button } from "@/components/ui/button";
import { buildCompareCsv } from "@/lib/compareCsv";
import { downloadTextFile } from "@/lib/clientCsv";
```

After `const MAX_COMPARE = 4;` (line 128), add:

```ts

// SCU-1.3 (spec B1.3) — ONE row model drives both the compare <table> and its
// CSV, so the two can never disagree. `display` is the on-screen cell
// (formatted, may be JSX); `raw` is the CSV value (unformatted number or
// string; null -> empty cell, the on-screen "—" is display-only).
interface CompareCell {
  raw: number | string | null;
  display: ReactNode;
}

interface CompareRow {
  key: string;
  label: ReactNode;
  /** The CSV metric label — carries the unit when the value has one. */
  csvLabel: string;
  labelClassName?: string;
  cellClassName: string;
  testId: (scenarioId: number) => string;
  cells: CompareCell[];
}

const DOWNLOAD_BUTTON_CLASS =
  "text-xs border rounded px-2 py-1 hover:bg-muted disabled:opacity-50 disabled:pointer-events-none";
```

After `const [selectedIds, setSelectedIds] = useState<number[]>(() => [scenarioId]);` (line 269), add:

```ts
  // SCU-1.3 (spec B1.3, deviation 9) — the picker starts hidden and opens on
  // its own when 2+ scenarios are already selected at mount. Today the
  // selection always starts at [scenarioId], so that branch is unreachable;
  // it is the spec's rule written down, not a code path anything exercises.
  const [pickerOpen, setPickerOpen] = useState(() => selectedIds.length >= 2);
```

In `toggleList` (line 300), change:

```tsx
    <div className="p-2 border-b flex-shrink-0" data-testid="cost-summary-compare-toggles">
```

to:

```tsx
    <div id="cost-summary-compare-toggles" className="p-2 border-b flex-shrink-0" data-testid="cost-summary-compare-toggles">
```

Directly after the `toggleList` constant (after line 329), add:

```tsx

  // SCU-1.3 (spec B1.3) — the bar replaces both titles: Compare toggle left,
  // Download right (null = no download in this state), picker beneath.
  const summaryBar = (download: ReactNode) => (
    <>
      <div className="flex items-center justify-between gap-2 p-2 border-b flex-shrink-0" data-testid="cost-summary-bar">
        {sameModelScenarios.length > 0 ? (
          <Button
            type="button"
            size="sm"
            data-testid="button-toggle-compare"
            aria-expanded={pickerOpen}
            aria-controls="cost-summary-compare-toggles"
            onClick={() => setPickerOpen(open => !open)}
          >
            Compare Scenario
          </Button>
        ) : (
          <span />
        )}
        {download}
      </div>
      {pickerOpen && toggleList}
    </>
  );
```

In the `!result` branch (line 335), replace `{toggleList}` with `{summaryBar(null)}`.

In the single-mode return, replace lines 440-453:

```tsx
        {toggleList}
        <div className="flex items-center justify-between p-2 border-b flex-shrink-0">
          <span className="text-sm font-medium">Solution Summary</span>
          <button
            type="button"
            data-testid="button-download-cost-summary-csv"
            className="text-xs border rounded px-2 py-1 hover:bg-muted disabled:opacity-50 disabled:pointer-events-none"
            onClick={() => download("costSummary", "csv")}
            disabled={disabledReasonFor("costSummary") != null}
            title={disabledReasonFor("costSummary")}
          >
            Download CSV
          </button>
        </div>
```

with:

```tsx
        {summaryBar(
          <button
            type="button"
            data-testid="button-download-cost-summary-csv"
            className={DOWNLOAD_BUTTON_CLASS}
            onClick={() => download("costSummary", "csv")}
            disabled={disabledReasonFor("costSummary") != null}
            title={disabledReasonFor("costSummary")}
          >
            Download CSV
          </button>,
        )}
```

Replace the compare branch. That is everything from the comment `// Compare mode: 2-4 solved, non-stale, same-model scenarios selected.` (line 485) through the final `}` that closes `CostSummaryTab`. The replacement keeps every testid and every displayed string. It only moves cell rendering onto the row model.

```tsx
  // Compare mode: 2-4 solved, non-stale, same-model scenarios selected.
  // SCU-1.3 — Download CSV now exports this table (spec B1.3).
  const results = compareScenarios.map(s => s.result!);
  const sharedBands = scenariosShareBands(results);
  // CH4OS — same no-incumbent rule as the single view, per column.
  const noIncumbentFor = (s: Scenario) =>
    modelId === MAX_COVERAGE_MODEL_ID && !hasIncumbent(classifyResultOutcome(s.result!));
  // CH4O-10 (decisions 5-8/10) — same envelope-shape gate as the
  // single-scenario view, evaluated across the WHOLE selection: a selected
  // column without `details.coveragePct` renders "—" rather than dropping the
  // row for every column.
  const compareShowCoverageRows = compareScenarios.some(
    s => typeof (s.result!.details as { coveragePct?: number } | undefined)?.coveragePct === "number" || noIncumbentFor(s),
  );

  // Raw CSV values for distance-bearing rows are in the DISPLAY unit, named
  // in the label (deviation 11). null while the canonical unit is unresolved.
  const toDisplayOrNull = (v: number | null | undefined): number | null =>
    v == null || canonicalDistanceUnit == null ? null : unit.toDisplay(v, canonicalDistanceUnit);
  const unitSuffix = unitLabel ? ` (${unitLabel})` : "";
  const rateLabel = rateUnitLabel(canonicalDistanceUnit, unit);
  const rateSuffix = rateLabel ? ` (${rateLabel})` : "";
  const MONO = "p-2 font-mono";
  const legacyNote = <span className="ml-1 text-[10px] font-sans text-muted-foreground">{LEGACY_RATE_LABEL}</span>;
  const EMPTY: CompareCell = { raw: null, display: "—" };

  const compareRows: CompareRow[] = [];
  const pushRow = (row: Omit<CompareRow, "cells">, cell: (s: Scenario) => CompareCell) =>
    compareRows.push({ ...row, cells: compareScenarios.map(cell) });

  // Asymmetric conversion is CORRECT, not a bug: objectiveDimension maps
  // coverage to "percent" (non-converting) and min_distance to
  // "demand-distance" (converting), so toggling the display unit changes one
  // column and leaves its neighbour frozen. Do not "fix" this. The CSV takes
  // the solver's raw objective (deviation 11).
  pushRow(
    { key: "objective", label: "Objective", csvLabel: "Objective", cellClassName: MONO, testId: id => `cost-summary-compare-objective-${id}` },
    s => noIncumbentFor(s)
      ? { raw: null, display: resultQualityText(s.result!) }
      : {
          raw: s.result!.objective,
          display: modelId != null && canonicalDistanceUnit != null
            ? formatObjective(modelId, scenarioObjectiveMode(s), s.result!.objective, canonicalDistanceUnit, unit)
            : formatChenObjective(s.result!.objective, scenarioObjectiveMode(s)) ?? s.result!.objective.toLocaleString(),
        },
  );

  // CH4O-10 (decisions 5-8) — Chapter 4's coverage rows; decision 10 is what
  // lets a cross-mode (coverage + min_distance) selection reach them.
  if (compareShowCoverageRows) {
    pushRow(
      { key: "high-service-cutoff", label: "High service cutoff", csvLabel: `High service cutoff${unitSuffix}`, cellClassName: MONO, testId: id => `cost-summary-compare-high-service-cutoff-${id}` },
      s => {
        const v = (s.result!.details as { highServiceDistMi?: number } | undefined)?.highServiceDistMi;
        return typeof v === "number" ? { raw: toDisplayOrNull(v), display: formatDistance(v, canonicalDistanceUnit, unit) } : EMPTY;
      },
    );
    pushRow(
      { key: "coverage-pct", label: "% of demand within high service", csvLabel: "% of demand within high service", cellClassName: MONO, testId: id => `cost-summary-compare-coverage-pct-${id}` },
      s => {
        const v = (s.result!.details as { coveragePct?: number } | undefined)?.coveragePct;
        return typeof v === "number" && !noIncumbentFor(s) ? { raw: v, display: `${v.toFixed(2)} %` } : EMPTY;
      },
    );
    pushRow(
      { key: "covered-demand", label: "Total demand within high service", csvLabel: "Total demand within high service", cellClassName: MONO, testId: id => `cost-summary-compare-covered-demand-${id}` },
      s => {
        const v = (s.result!.details as { coveredDemand?: number } | undefined)?.coveredDemand;
        return typeof v === "number" && !noIncumbentFor(s) ? { raw: v, display: v.toLocaleString() } : EMPTY;
      },
    );
  }

  // CH4OS (spec §6.2) — Model 1's max coverable demand; blank for scenarios
  // whose envelope does not carry it. A not-proven value is a lower bound,
  // never "the maximum" (spec §5) — the "(best found)" suffix is display-only.
  if (compareScenarios.some(s => typeof (s.result!.details as { maxCoverableDemand?: unknown } | undefined)?.maxCoverableDemand === "number")) {
    pushRow(
      { key: "max-coverable-demand", label: "Max coverable demand (Model 1)", csvLabel: "Max coverable demand (Model 1)", cellClassName: MONO, testId: id => `cost-summary-compare-max-coverable-demand-${id}` },
      s => {
        const d = s.result!.details as { maxCoverableDemand?: number; model1?: { optimal?: boolean } } | undefined;
        return typeof d?.maxCoverableDemand === "number"
          ? { raw: d.maxCoverableDemand, display: `${d.maxCoverableDemand.toLocaleString()}${d.model1?.optimal === false ? " (best found)" : ""}` }
          : { raw: null, display: "" };
      },
    );
  }

  // ch4-fixes item 3 — JADE inbound/outbound cost split, gated on PRESENCE
  // across the selection, never on modelId; a column lacking it shows "—".
  if (compareScenarios.some(s => s.result!.metrics.inboundCost != null)) {
    pushRow(
      { key: "inbound", label: "Inbound cost", csvLabel: "Inbound cost", cellClassName: MONO, testId: id => `cost-summary-compare-inbound-${id}` },
      s => s.result!.metrics.inboundCost != null ? { raw: s.result!.metrics.inboundCost, display: s.result!.metrics.inboundCost.toLocaleString() } : EMPTY,
    );
  }
  if (compareScenarios.some(s => s.result!.metrics.outboundCost != null)) {
    pushRow(
      { key: "outbound", label: "Outbound cost", csvLabel: "Outbound cost", cellClassName: MONO, testId: id => `cost-summary-compare-outbound-${id}` },
      s => s.result!.metrics.outboundCost != null ? { raw: s.result!.metrics.outboundCost, display: s.result!.metrics.outboundCost.toLocaleString() } : EMPTY,
    );
  }

  // ch9-tc-9 (point 12) — the four rates EACH column's own result was SOLVED
  // AT. Gated on modelId, not metric presence — an all-legacy selection still
  // renders these rows with a labelled fallback.
  if (modelId === JADE_MODEL_ID) {
    const rateRaw = (rate: number) =>
      canonicalDistanceUnit == null ? null : rateConversion(unit).toDisplay(rate, canonicalDistanceUnit);
    pushRow(
      { key: "rate-ic", label: `Inbound rate${rateSuffix}`, csvLabel: `Inbound rate${rateSuffix}`, cellClassName: MONO, testId: id => `cost-summary-compare-rate-ic-${id}` },
      s => {
        const { rates, legacy } = solvedAtRates(s.result);
        return { raw: rateRaw(rates.icTransCost), display: <>{formatRate(rates.icTransCost, canonicalDistanceUnit, unit)}{legacy && legacyNote}</> };
      },
    );
    pushRow(
      { key: "min-ic", label: "Inbound min ($/ton)", csvLabel: "Inbound min ($/ton)", cellClassName: MONO, testId: id => `cost-summary-compare-min-ic-${id}` },
      s => {
        const { rates, legacy } = solvedAtRates(s.result);
        return { raw: rates.icMinTrans, display: <>{rates.icMinTrans.toLocaleString()}{legacy && legacyNote}</> };
      },
    );
    pushRow(
      { key: "rate-ob", label: `Outbound rate${rateSuffix}`, csvLabel: `Outbound rate${rateSuffix}`, cellClassName: MONO, testId: id => `cost-summary-compare-rate-ob-${id}` },
      s => {
        const { rates, legacy } = solvedAtRates(s.result);
        return { raw: rateRaw(rates.obTransCost), display: <>{formatRate(rates.obTransCost, canonicalDistanceUnit, unit)}{legacy && legacyNote}</> };
      },
    );
    pushRow(
      { key: "min-ob", label: "Outbound min ($/ton)", csvLabel: "Outbound min ($/ton)", cellClassName: MONO, testId: id => `cost-summary-compare-min-ob-${id}` },
      s => {
        const { rates, legacy } = solvedAtRates(s.result);
        return { raw: rates.obMinTrans, display: <>{rates.obMinTrans.toLocaleString()}{legacy && legacyNote}</> };
      },
    );
  }

  const distanceLabel = `${compareShowCoverageRows ? "Avg distance to customers" : "Weighted avg. distance"}${unitSuffix}`;
  pushRow(
    { key: "distance", label: distanceLabel, csvLabel: distanceLabel, cellClassName: MONO, testId: id => `cost-summary-compare-distance-${id}` },
    s => noIncumbentFor(s)
      ? EMPTY
      : { raw: toDisplayOrNull(s.result!.metrics.weightedAvgDistance), display: formatDistanceValueOnly(s.result!.metrics.weightedAvgDistance, canonicalDistanceUnit, unit) },
  );

  // T5 (B5) — open-facility set by city, gated on supportsFacilityStatus.
  // T11 (critical fix) — PER-SCENARIO identity, resolved from THIS column's
  // own `s.inputs`; `locationById`'s mere presence selects the layout (its
  // VALUES are ignored). CSV value: the sorted open ids, "; "-joined.
  if (supportsFacilityStatus) {
    pushRow(
      { key: "open-facilities", label: "Open facilities", csvLabel: "Open facilities", cellClassName: "p-2", testId: id => `cost-summary-compare-open-facilities-cities-${id}` },
      s => {
        const ids = [...openFacilityIds(s.result!)].sort();
        const identity = locationById ? buildEntityIdentityById(modelId, dataset, s.inputs) : null;
        const display = identity ? (
          <div className="flex flex-wrap gap-x-3 gap-y-1">
            {ids.map(id => {
              const entry = identity[id];
              const loc = entry && (entry.city || entry.state) ? { city: entry.city, state: entry.state } : undefined;
              const displayId = entry?.displayId ?? id;
              return (
                <span key={id} className="flex flex-col" data-testid={`cost-summary-compare-open-facility-${s.id}-${id}`}>
                  <span>{loc ? `${loc.city}, ${loc.state}` : facilityCityLabel(id, baseFacilities, extractAddedFacilities(s.inputs))}</span>
                  <span className="font-mono text-[10px] text-muted-foreground">{displayId}</span>
                </span>
              );
            })}
            {ids.length === 0 && "—"}
          </div>
        ) : (
          openFacilityCityList(s.result!, s.inputs, baseFacilities)
        );
        return { raw: ids.length > 0 ? ids.join("; ") : null, display };
      },
    );
  }

  pushRow(
    { key: "runtime", label: "Runtime", csvLabel: "Runtime (s)", cellClassName: MONO, testId: id => `cost-summary-compare-runtime-${id}` },
    s => ({ raw: s.result!.runTimeSec, display: `${s.result!.runTimeSec.toFixed(2)}s` }),
  );
  pushRow(
    { key: "quality", label: "Quality", csvLabel: "Quality", cellClassName: "p-2", testId: id => `cost-summary-compare-quality-${id}` },
    s => ({ raw: resultQualityText(s.result!), display: resultQualityText(s.result!) }),
  );

  // SCU-1.2/1.3 (spec B1.9) — EXCLUSIVE band rows + overflow, only when every
  // column shares the same real boundaries.
  if (sharedBands) {
    const boundaries = bandBoundaries(results[0]);
    const fmt = (v: number) =>
      unit.toDisplay(v, canonicalDistanceUnit!).toLocaleString(undefined, { maximumFractionDigits: 4, useGrouping: false });
    const labels = unitLabel == null
      ? [...boundaries, OVERFLOW_BAND].map(() => "—")
      : exclusiveBandLabels(boundaries, fmt, unitLabel);
    const exclusiveByColumn = compareScenarios.map(s =>
      frozenBandCoverageToExclusive(s.result!.metrics.bandCoverage, bandDecimals(modelId), frozenBandShape(modelId)),
    );
    [...boundaries, OVERFLOW_BAND].forEach((band, i) => {
      compareRows.push({
        key: `band-${band}`,
        label: labels[i],
        csvLabel: `${labels[i]} (%)`,
        labelClassName: "font-mono",
        cellClassName: MONO,
        testId: id => `cost-summary-compare-band-${band}-${id}`,
        cells: exclusiveByColumn.map(rows => {
          const coverage = rows?.find(b => b.band === band);
          return coverage ? { raw: coverage.percent, display: `${coverage.percent}%` } : EMPTY;
        }),
      });
    });
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {summaryBar(
        <button
          type="button"
          data-testid="button-download-cost-summary-csv"
          className={DOWNLOAD_BUTTON_CLASS}
          onClick={() => downloadTextFile("cost-summary-compare.csv", buildCompareCsv(compareRows, compareScenarios), "text/csv")}
        >
          Download CSV
        </button>,
      )}
      <div className="overflow-auto flex-1 p-2" data-testid="cost-summary-compare-table">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr>
              <th className="text-left p-2 border-b"></th>
              {compareScenarios.map(s => (
                <th key={s.id} className="text-left p-2 border-b" data-testid={`cost-summary-compare-column-${s.id}`}>
                  {s.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {compareRows.map(row => (
              <tr key={row.key}>
                <td className={`p-2 text-muted-foreground${row.labelClassName ? ` ${row.labelClassName}` : ""}`}>{row.label}</td>
                {compareScenarios.map((s, col) => (
                  <td key={s.id} className={row.cellClassName} data-testid={row.testId(s.id)}>
                    {row.cells[col].display}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {!sharedBands && (
          <p className="text-xs text-muted-foreground p-2" data-testid="cost-summary-compare-bands-note">
            Selected scenarios use different distance bands — band coverage isn't shown side by side.{" "}
            {compareScenarios.map(s => `${s.name}: ${formatBandList(bandBoundaries(s.result!), canonicalDistanceUnit, unit)}`).join("; ")}
          </p>
        )}
      </div>
    </div>
  );
}
```

This replacement deletes the old comment `// Download CSV is hidden here (compare is a read-only side-by-side; …)`, which is no longer true.

- [ ] **Step 6: Run them to verify they pass**

Run: `pnpm --filter studio exec vitest run src/__tests__/compareCsv.test.ts src/__tests__/CostSummaryTab.test.tsx src/__tests__/JadeFlowsTab.test.tsx`
Expected: PASS. `JadeFlowsTab.test.tsx:274-320` proves the moved `downloadClientCsv` is byte-identical, because it spies on the same `new Blob([text], …)`.

- [ ] **Step 7: e2e sweep**

Run these greps now:

```bash
grep -rn "cost-summary-compare-toggle\|cost-summary-compare-toggles\|button-download-cost-summary-csv\|Solution Summary — Compare" artifacts/studio/e2e/
```

At `46d2f98` this finds `two-echelon.spec.ts:174,178`, `bundle6-ui-tweaks.spec.ts:212,215`, `jade-transport-costs.spec.ts:168`, `workspace-ux-r1-r9.spec.ts:245,246,287,288`. Every one of them reaches the picker, which is now hidden by default. No spec asserts the old titles or the absence of Download in compare mode.

Rewrites (insert one line; the existing assertions stay):
- `two-echelon.spec.ts`, after line 173 (`await page.getByTestId("sidebar-output-cost-summary").click();`), insert:
  `      await page.getByTestId("button-toggle-compare").click({ timeout: HEADER_TIMEOUT }); // SCU-1.3 — picker is hidden by default`
- `bundle6-ui-tweaks.spec.ts`, after line 211 (`await page.getByTestId("sidebar-output-cost-summary").click();`), insert the same line.
- `jade-transport-costs.spec.ts`, after line 167 (`await page.getByTestId("sidebar-output-cost-summary").click({ timeout: HEADER_TIMEOUT });`), insert:
  `    await page.getByTestId("button-toggle-compare").click({ timeout: HEADER_TIMEOUT }); // SCU-1.3 — picker is hidden by default`
- `workspace-ux-r1-r9.spec.ts`: insert the `jade-transport-costs` line after line 244 (`await page.getByTestId("sidebar-output-cost-summary").click();`). Insert the 6-space-indented `two-echelon` line after line 286.

Each spec already declares `HEADER_TIMEOUT` (verify with `grep -n "const HEADER_TIMEOUT" <spec>` before editing). If the local two-server setup is up, run the four specs with `E2E_BASE_URL=http://localhost:<studio-port> pnpm --filter studio exec playwright test e2e/two-echelon.spec.ts e2e/bundle6-ui-tweaks.spec.ts e2e/jade-transport-costs.spec.ts e2e/workspace-ux-r1-r9.spec.ts`. Otherwise record `deferred to SCU-1.10`.

- [ ] **Step 8: Gate**

Run the vitest-count check, then the global gate, each separately. Every command must exit 0.

- [ ] **Step 9: Changelog**

Append `### SCU-1.3 — Solution Summary bar and compare CSV`. Record: the titles are gone; the picker is hidden behind `button-toggle-compare`; Download CSV appears in both modes and builds the compare CSV from the table's row model; `lib/clientCsv.ts` now holds the moved JADE Flows helpers; deviations 9 and 11; the four rewritten e2e specs; and the gate counts.

- [ ] **Step 10: Commit**

```bash
git add artifacts/studio/src/lib/clientCsv.ts artifacts/studio/src/lib/compareCsv.ts artifacts/studio/src/__tests__/compareCsv.test.ts
```

```bash
[ "$(git rev-parse --abbrev-ref HEAD)" != "main" ] || exit 1
```

```bash
git commit artifacts/studio/src/lib/clientCsv.ts artifacts/studio/src/lib/compareCsv.ts artifacts/studio/src/__tests__/compareCsv.test.ts artifacts/studio/src/components/workspace/tabs/CostSummaryTab.tsx artifacts/studio/src/components/workspace/tabs/JadeFlowsTab.tsx artifacts/studio/src/__tests__/CostSummaryTab.test.tsx artifacts/studio/e2e/two-echelon.spec.ts artifacts/studio/e2e/bundle6-ui-tweaks.spec.ts artifacts/studio/e2e/jade-transport-costs.spec.ts artifacts/studio/e2e/workspace-ux-r1-r9.spec.ts docs/CHANGELOG-implementation.md -m "[SCU-1.3] add Solution Summary compare toggle and compare-mode CSV" -m "Deviation 9: picker auto-open is the lazy initial state (selection starts at [scenarioId]). Deviation 11: CSV objective is the raw solver value." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
## Task SCU-1.4: Remove duplicate tab titles (B1.4) + rename Plant Capability Matrix (B1.8)

**Owner role:** frontend-engineer. **Spec:** B1.4, B1.8. **Deviation:** 7. **Depends on:** SCU-1.2 (`ServiceStatsTab.tsx`: this task edits `:296-298`, adjacent to SCU-1.2's `:282-293`).

**Files:**
- Modify: `components/workspace/tabs/OpenWarehousesTab.tsx:200-202`; `AssignmentsTab.tsx:169-171`; `JadeAssignmentsTab.tsx:301-303`; `FlowsTab.tsx:111-113`; `JadeFlowsTab.tsx:396`; `ServiceStatsTab.tsx:297-298` (all under `artifacts/studio/src/`)
- Modify: `artifacts/studio/src/pages/Workspace.tsx:1277`
- Test: append one `describe` to each of `OpenWarehousesTab.test.tsx`, `AssignmentsTab.test.tsx`, `JadeAssignmentsTab.test.tsx`, `FlowsTab.test.tsx`, `JadeFlowsTab.test.tsx`, `ServiceStatsTab.test.tsx`; edit `Workspace.Jade.test.tsx:149-152`
- Modify: `docs/CHANGELOG-implementation.md`

**Interfaces:**
- Consumes: nothing new.
- Produces: no testid changes. The header rows keep their download testids. Each header that loses its only left-hand child switches from `justify-between` to `justify-end`, so Download stays right-aligned. A lone child under `justify-between` would sit on the left. JADE Flows keeps `justify-between`, because its segmented control stays on the left.

- [ ] **Step 0: Invoke the simplicity skills**

Skill tool: `andrej-karpathy-skills:karpathy-guidelines`, then `ponytail:ponytail`.

- [ ] **Step 1: Write the failing tests**

Append to `artifacts/studio/src/__tests__/OpenWarehousesTab.test.tsx`:

```tsx

// SCU-1.4 (spec B1.4) — the title equal to the tab name is gone; Download
// stays right-aligned in the same header row.
describe("OpenWarehousesTab — no duplicate title (SCU-1.4)", () => {
  it("renders no 'Open Warehouses' title and keeps Download right-aligned", () => {
    render(<OpenWarehousesTab result={result} scenarioId={1} />);
    expect(screen.queryByText("Open Warehouses")).not.toBeInTheDocument();
    expect(screen.getByTestId("button-download-open-warehouses-csv").closest("div.border-b")).toHaveClass("justify-end");
  });
});
```

Append to `AssignmentsTab.test.tsx`:

```tsx

describe("AssignmentsTab — no duplicate title (SCU-1.4)", () => {
  it("renders no 'Customer Assignments' title and keeps Download right-aligned", () => {
    render(<AssignmentsTab result={result} scenarioId={1} distanceUnit="mi" />);
    expect(screen.queryByText("Customer Assignments")).not.toBeInTheDocument();
    expect(screen.getByTestId("button-download-assignments-csv").closest("div.border-b")).toHaveClass("justify-end");
  });
});
```

Append to `JadeAssignmentsTab.test.tsx`:

```tsx

describe("JadeAssignmentsTab — no duplicate title (SCU-1.4)", () => {
  it("renders no 'Customer Assignments' title and keeps the count/filter/Download group right-aligned", () => {
    render(<JadeAssignmentsTab result={twoRowsResult} dataset={dataset} bands={bands} scenarioId={1} />);
    expect(screen.queryByText("Customer Assignments")).not.toBeInTheDocument();
    expect(screen.getByTestId("button-download-jadeassignments-csv").closest("div.border-b")).toHaveClass("justify-end");
  });
});
```

Append to `FlowsTab.test.tsx`:

```tsx

describe("FlowsTab — no duplicate title (SCU-1.4)", () => {
  it("renders no 'Flows' title and keeps Download right-aligned", () => {
    render(<FlowsTab result={transportResult} scenarioId={1} />);
    expect(screen.queryByText("Flows", { selector: "span" })).not.toBeInTheDocument();
    expect(screen.getByTestId("button-download-flows-csv").closest("div.border-b")).toHaveClass("justify-end");
  });
});
```

Append to `JadeFlowsTab.test.tsx`:

```tsx

// SCU-1.4 — only the TAB-level "Flows" title goes; the segmented control
// (left) and the per-leg sub-table headers stay (spec B1.4).
describe("JadeFlowsTab — no duplicate tab-level title (SCU-1.4)", () => {
  it("renders no tab-level 'Flows' title but keeps the segmented control and the 'Flows' column header", () => {
    render(<JadeFlowsTab result={jadeResult} dataset={dataset} bands={bands} />);
    expect(screen.queryByText("Flows", { selector: "span" })).not.toBeInTheDocument();
    expect(screen.getByText("Warehouse → Customer")).toBeInTheDocument();
    expect(screen.getByTestId("button-download-jade-flows-pw-csv")).toBeInTheDocument();
  });
});
```

Append to `ServiceStatsTab.test.tsx`:

```tsx

describe("ServiceStatsTab — no duplicate title (SCU-1.4)", () => {
  it("renders no 'Service Stats' title and keeps Download right-aligned", () => {
    render(<ServiceStatsTab result={result} scenarioId={1} modelId="p-median-us" />);
    expect(screen.queryByText("Service Stats")).not.toBeInTheDocument();
    expect(screen.getByTestId("button-download-service-stats-csv").closest("div.border-b")).toHaveClass("justify-end");
  });
});
```

In `Workspace.Jade.test.tsx`, change the test title at line 149 to `"shows Plants and Plant Capability Matrix sidebar entries alongside the reused Warehouses/Customers/Distances"`. After line 152 (`expect(screen.getByTestId("sidebar-input-capability-matrix")).toBeInTheDocument();`), add:

```ts
    // SCU-1.4 (spec B1.8) — label renamed; id/testid unchanged.
    expect(screen.getByTestId("sidebar-input-capability-matrix")).toHaveTextContent("Plant Capability Matrix");
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm --filter studio exec vitest run src/__tests__/OpenWarehousesTab.test.tsx src/__tests__/AssignmentsTab.test.tsx src/__tests__/JadeAssignmentsTab.test.tsx src/__tests__/FlowsTab.test.tsx src/__tests__/JadeFlowsTab.test.tsx src/__tests__/ServiceStatsTab.test.tsx src/__tests__/Workspace.Jade.test.tsx`
Expected: FAIL in every new test. Examples: `expected document not to contain element, found <span class="text-sm font-medium">Open Warehouses</span>`; `expected element to have text content "Plant Capability Matrix"`, received `Capability Matrix`.

- [ ] **Step 3: Implement**

`OpenWarehousesTab.tsx:200-202`, replace:

```tsx
      <div className="flex items-center justify-between p-2 border-b flex-shrink-0">
        <span className="text-sm font-medium">Open Warehouses</span>
```

with:

```tsx
      <div className="flex items-center justify-end p-2 border-b flex-shrink-0">
```

`AssignmentsTab.tsx:169-171`, replace:

```tsx
      <div className="flex items-center justify-between p-2 border-b flex-shrink-0">
        <span className="text-sm font-medium">Customer Assignments</span>
```

with:

```tsx
      <div className="flex items-center justify-end p-2 border-b flex-shrink-0">
```

`JadeAssignmentsTab.tsx:301-303`, replace:

```tsx
      <div className="flex items-center justify-between gap-2 p-2 border-b flex-shrink-0 flex-wrap">
        <span className="text-sm font-medium">Customer Assignments</span>
```

with:

```tsx
      <div className="flex items-center justify-end gap-2 p-2 border-b flex-shrink-0 flex-wrap">
```

`FlowsTab.tsx:111-113`, replace:

```tsx
      <div className="flex items-center justify-between p-2 border-b flex-shrink-0">
        <span className="text-sm font-medium">Flows</span>
```

with:

```tsx
      <div className="flex items-center justify-end p-2 border-b flex-shrink-0">
```

`JadeFlowsTab.tsx:396`, delete the single line:

```tsx
          <span className="text-sm font-medium">Flows</span>
```

The surrounding `justify-between` header and `{segmentedControl}` stay.

`ServiceStatsTab.tsx:297-298`, replace:

```tsx
      <div className="flex items-center justify-between p-2 border-b flex-shrink-0">
        <span className="text-sm font-medium">Service Stats</span>
```

with:

```tsx
      <div className="flex items-center justify-end p-2 border-b flex-shrink-0">
```

The JADE `Plant Production` sub-title (`ServiceStatsTab.tsx:362`) stays.

`Workspace.tsx:1277`, replace:

```ts
        { id: "capability-matrix", label: "Capability Matrix" },
```

with:

```ts
        { id: "capability-matrix", label: "Plant Capability Matrix" },
```

- [ ] **Step 4: Run them to verify they pass**

Run the same command as Step 2. Expected: PASS.

- [ ] **Step 5: e2e sweep**

Run these greps now:

```bash
grep -rn "Open Warehouses\|Customer Assignments\|Service Stats\|Capability Matrix" artifacts/studio/e2e/
grep -rn "getByText(\"Flows\"\|hasText: \"Flows\"" artifacts/studio/e2e/
```

At `46d2f98` the first grep finds 28 lines, all of them comments or `test`/`describe` titles: `workspace-fixups.spec.ts:8,246,247,281,312,326`, `workspace-fixups-2.spec.ts:9,10,292,301,302`, `nonjade-servicestats-live-coverage.spec.ts:228,245,340,432,448`, `chen-bands-units-qa.spec.ts:357`, `bundle2-fastfollow.spec.ts:309`, `delivery-teaching.spec.ts:22,34,260`, `max-coverage.spec.ts:179`, `jade-ch9-workspace-bundle.spec.ts:9,10,330,396,434,527`. Every Capability Matrix interaction uses `sidebar-input-capability-matrix` / `capability-matrix-tab` (deviation 7). The second grep finds nothing. **No spec asserts any removed title or the old label, so there is nothing to rewrite.** Record that in the changelog. When the servers are up, run `E2E_BASE_URL=… pnpm --filter studio exec playwright test e2e/workspace-fixups.spec.ts e2e/jade-ch9-workspace-bundle.spec.ts`. They exercise the renamed entry and the JADE output tabs.

- [ ] **Step 6: Gate**

Run the vitest-count check, then the global gate, each separately. Every command must exit 0.

- [ ] **Step 7: Changelog**

Append `### SCU-1.4 — duplicate titles removed, Plant Capability Matrix`. Record the six headers, the `justify-end` switch, deviation 7, the grep result (no e2e rewrite needed) and the gate counts.

- [ ] **Step 8: Commit**

```bash
[ "$(git rev-parse --abbrev-ref HEAD)" != "main" ] || exit 1
```

```bash
git commit artifacts/studio/src/components/workspace/tabs/OpenWarehousesTab.tsx artifacts/studio/src/components/workspace/tabs/AssignmentsTab.tsx artifacts/studio/src/components/workspace/tabs/JadeAssignmentsTab.tsx artifacts/studio/src/components/workspace/tabs/FlowsTab.tsx artifacts/studio/src/components/workspace/tabs/JadeFlowsTab.tsx artifacts/studio/src/components/workspace/tabs/ServiceStatsTab.tsx artifacts/studio/src/pages/Workspace.tsx artifacts/studio/src/__tests__/OpenWarehousesTab.test.tsx artifacts/studio/src/__tests__/AssignmentsTab.test.tsx artifacts/studio/src/__tests__/JadeAssignmentsTab.test.tsx artifacts/studio/src/__tests__/FlowsTab.test.tsx artifacts/studio/src/__tests__/JadeFlowsTab.test.tsx artifacts/studio/src/__tests__/ServiceStatsTab.test.tsx artifacts/studio/src/__tests__/Workspace.Jade.test.tsx docs/CHANGELOG-implementation.md -m "[SCU-1.4] remove duplicate output-tab titles and rename Plant Capability Matrix" -m "Deviation 7: no e2e asserts the old label (testid-only), so no spec rewrite." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
## Task SCU-1.5: Inline Save in the Layers row for delivery + max-coverage (B1.2)

**Owner role:** frontend-engineer. **Spec:** B1.2. **Deviation:** 8. **Depends on:** nothing (wave A).

**Files:**
- Modify: `artifacts/studio/src/components/workspace/tabs/InputMapTab.tsx`: `:160-169` (delete the `showInlineSave` prop and its doc), `:183-195` (`fixedGeography` doc no longer lists Save), `:765` (delete the default), `:1033-1052` (Save gate + comment)
- Modify: `artifacts/studio/src/pages/Workspace.tsx`: `:2242-2254` (comment), `:2336-2356` (`saveInLayersRow`), `:3394-3397` (comment), `:3424-3431` (delete the COSM-2 comment + `showInlineSave` prop)
- Test: `artifacts/studio/src/__tests__/InputMapTab.deliveryFixedGeography.test.tsx:140-149`
- Test: `artifacts/studio/src/__tests__/Workspace.test.tsx:1325` (title only), `:1360-1376`, `:3223-3253`
- e2e: `artifacts/studio/e2e/max-coverage.spec.ts:356-367`; `artifacts/studio/e2e/delivery-teaching.spec.ts:191-200`
- Modify: `docs/CHANGELOG-implementation.md`

**Interfaces:**
- Consumes: nothing new.
- Produces: `InputMapTab` "pmedian" mode renders the inline `button-save` inside `pmedian-map-toolbar` whenever `onSave` is passed, whatever `fixedGeography` is. `fixedGeography` now governs geometry only. The `showInlineSave` prop no longer exists. In `Workspace.tsx`, `saveInLayersRow` is true on the Input Map for `p-median-us`, `p-median-brazil`, `max-coverage-us` and `delivery-teaching-us`, so `showToolbarSave` is false there and `workspace-toolbar-row` does not render on that view.

- [ ] **Step 0: Invoke the simplicity skills**

Skill tool: `andrej-karpathy-skills:karpathy-guidelines`, then `ponytail:ponytail`.

- [ ] **Step 1: Rewrite the failing tests**

`InputMapTab.deliveryFixedGeography.test.tsx`, replace lines 140-149 (the `// Layers-row Save — §14.5 keeps this hidden …` comment and the test `"still hides button-save even when onSave is supplied — geography stays fixed"`) with:

```tsx
  // SCU-1.5 (spec B1.2) — `fixedGeography` means GEOMETRY only now. Saving
  // status/demand edits is not a geometry change, so the inline Layers-row
  // Save renders whenever a caller wires `onSave` — and stays absent when no
  // `onSave` is wired (the gate is `onSave`, not `fixedGeography`).
  it("renders the inline button-save in the Layers row when onSave is supplied, even with fixed geography", () => {
    const onSave = vi.fn();
    renderDeliveryMap({ onSave });
    const layersRow = screen.getByTestId("pmedian-map-toolbar");
    const save = within(layersRow).getByTestId("button-save");
    expect(save).toBeEnabled();
    fireEvent.click(save);
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it("renders no Layers-row Save when no onSave is wired", () => {
    renderDeliveryMap();
    expect(screen.queryByTestId("button-save")).toBeNull();
  });
```

That file does not import `within` today (line 2 is `import { render as rtlRender, fireEvent, screen } from "@testing-library/react";`). Change that line to `import { render as rtlRender, fireEvent, screen, within } from "@testing-library/react";`.

`Workspace.test.tsx`. Apply these bottom-up (3223-3253 first), because the replacement blocks change the line count:
- Line 1325: rename the test to `"a warehouse status edit on the Input Map enables the inline Layers-row Save without switching tabs, and Save PATCHes warehouseOverrides"`. Its body still holds: there is exactly one `button-save`, now the inline one.
- Replace lines 1360-1376 (the comment `// §14.5 still requires the map's OWN inline Save …` and the test `"the Input Map's own Layers-row Save stays hidden — only the shared toolbar Save renders"`) with:

```tsx
  // SCU-1.5 (spec B1.2) — delivery-teaching-us's Save now sits INLINE in the
  // Layers row (status/demand edits are real; `fixedGeography` governs
  // geometry only), and the separate shared toolbar row is suppressed on
  // this view. Scoped to `pmedian-map-toolbar`, so this asserts WHERE the
  // single Save lives, not merely that one exists.
  it("the Input Map's Save renders inline in the Layers row and the shared toolbar row is suppressed", () => {
    renderDeliveryWorkspace();
    fireEvent.click(screen.getByTestId("sidebar-input-input-map"));

    const layersRow = screen.getByTestId("pmedian-map-toolbar");
    expect(screen.getAllByTestId("button-save")).toHaveLength(1);
    expect(within(layersRow).getByTestId("button-save")).toBeInTheDocument();
    expect(screen.queryByTestId("workspace-toolbar-row")).not.toBeInTheDocument();
  });
```

- Replace lines 3223-3253 (the `// GATE: isEditableInputTab (input-map branch) …` comment block through the end of the test `"input-map gate: renders the pmedian-mode Input Map with its Save in the shared toolbar row, NOT the Layers row, for a Chen scenario"`) with:

```tsx
  // GATE: isEditableInputTab (input-map branch) + the InputMapTab
  // "pmedian"-mode render branch (Chen uses the fallback, no separate mode).
  // SCU-1.5 (spec B1.2) — inverts COSM-2: Chen's Save is back INLINE in the
  // Layers row (`showInlineSave` is deleted; `saveInLayersRow` lists
  // max-coverage-us), so the shared toolbar row does not render on this view.
  it("input-map gate: renders the pmedian-mode Input Map with its Save inline in the Layers row, and no shared toolbar row, for a Chen scenario", () => {
    renderChen();

    // Input Map is one-shot seeded active on mount (didSeedTabRef).
    expect(screen.getByTestId("input-map-tab")).toBeInTheDocument();
    const layersRow = screen.getByTestId("pmedian-map-toolbar");

    expect(screen.getAllByTestId("button-save")).toHaveLength(1);
    expect(within(layersRow).getByTestId("button-save")).toBeInTheDocument();
    expect(screen.queryByTestId("workspace-toolbar-row")).not.toBeInTheDocument();
  });
```

The Chen Warehouses and Customers gate tests that follow (`:3255-3274`) still expect a `button-save`. They hold unchanged, because the shared toolbar Save remains on every non-map editable tab.

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm --filter studio exec vitest run src/__tests__/InputMapTab.deliveryFixedGeography.test.tsx src/__tests__/Workspace.test.tsx`
Expected: FAIL. You will see `Unable to find an element by: [data-testid="button-save"]` within `pmedian-map-toolbar` (delivery and Chen), and for Chen `expected document not to contain element … workspace-toolbar-row`.

- [ ] **Step 3: Implement — `InputMapTab.tsx`**

Delete lines 160-169: the `/** COSM-2 — false for max-coverage-us …` doc comment and `showInlineSave?: boolean;`.

In the `fixedGeography` doc (lines 183-195), replace `Move/Copy/Delete, draggable added-entity markers, Layers-row Save)` with `Move/Copy/Delete, draggable added-entity markers)`. Then insert this sentence before `Defaults false —`: `SCU-1.5 (spec B1.2) — the Layers-row Save is NOT a geometry affordance and is gated on \`onSave\` alone.`

Delete line 765 (`  showInlineSave = true,`).

Replace lines 1033-1052. That is the `{/* R4 — Save relocated here …` comment and the line `{!fixedGeography && showInlineSave && onSave && (`. The new text:

```tsx
        {/* R4 — Save relocated here (out of Workspace.tsx's own toolbar);
            reuses the exact `button-save`/`text-unsaved-changes` testids the
            toolbar Save used. `ml-auto` pins it to the row's right edge,
            vertically centred with the layer checkboxes by the row's own
            `items-center`. SCU-1.5 (spec B1.2) — gated on `onSave` ALONE:
            every "pmedian"-arm model (p-median-us, p-median-brazil,
            max-coverage-us, delivery-teaching-us) wires it, and
            `fixedGeography` no longer hides it — saving a status/demand
            edit is not a geometry change. */}
        {onSave && (
```

The block body that follows (the `<div className="flex items-center gap-2 ml-auto">` with the Save button) is unchanged.

- [ ] **Step 4: Implement — `Workspace.tsx`**

Comment at lines 2242-2254 (inside `isEditableInputTab`). Replace from `// ch5-edit-6b — delivery-teaching-us joins too:` through `// teaching-us — only the shared toolbar gains one.` with:

```ts
      // ch5-edit-6b — delivery-teaching-us joins too: §14 made warehouse
      // status and customer demand/exclusion editable via the map. It renders
      // through this same "pmedian" arm with the exact same PMedianMapInputs
      // shape (pmedianMapInputsSlice/handlePMedianMapInputsChange). SCU-1.5
      // (spec B1.2) — its Save is the inline Layers-row one (`saveInLayersRow`
      // below lists it); `fixedGeography` governs geometry only.
```

Lines 2336-2356: replace the comment block that starts `// R4 — p-median-us's Input Map tab renders its OWN inline Save` and the two-line `const saveInLayersRow = …` declaration with:

```ts
  // R4 / SCU-1.5 (spec B1.2) — every "pmedian"-arm Input Map renders its OWN
  // inline Save in the Layers row (InputMapTab.tsx's `onSave`), so the shared
  // toolbar Save is suppressed on that view for all four models that render
  // the arm: p-median-us, p-median-brazil, max-coverage-us (inverts COSM-2)
  // and delivery-teaching-us (its map status/demand edits are real; geometry
  // stays fixed via `fixedGeography`). Other editable tabs keep the toolbar.
  const saveInLayersRow =
    activeView?.kind === "input" && activeView.entity === "input-map" &&
    (modelId === "p-median-us" || modelId === "p-median-brazil" || modelId === "max-coverage-us" || modelId === "delivery-teaching-us");
```

Lines 3394-3397: replace `// ch5-edit-6 (§14.5) — delivery-teaching-us's Input Map keeps` / `// fixed geography (add/copy/move/delete and the Layers-row Save` / `// all stay refused — InputMapTab.tsx's \`fixedGeography\` prop` with:

```ts
          // ch5-edit-6 (§14.5) / SCU-1.5 — delivery-teaching-us's Input Map
          // keeps fixed geography (add/copy/move/delete stay refused —
          // InputMapTab.tsx's `fixedGeography` prop
```

Leave the continuation lines 3398-3410 as they are.

Lines 3424-3431: delete the comment `// COSM-2 — max-coverage-us's Save moved OUT …` (6 lines) and the line `showInlineSave={modelId !== "max-coverage-us"}`.

- [ ] **Step 5: Run them to verify they pass**

Run: `pnpm --filter studio exec vitest run src/__tests__/InputMapTab.deliveryFixedGeography.test.tsx src/__tests__/Workspace.test.tsx src/__tests__/inputMapSaveWiring.test.ts src/__tests__/InputMapTab.maxCoverage.test.tsx src/__tests__/deliveryEditableInputs.test.tsx`
Expected: PASS. `inputMapSaveWiring.test.ts` still counts 4 `isDirty={saveEnabled}` mounts, because no mount was added or removed.

- [ ] **Step 6: e2e sweep**

Run these greps now:

```bash
grep -rn "workspace-toolbar-row\|pmedian-map-toolbar" artifacts/studio/e2e/
grep -rn "button-save" artifacts/studio/e2e/max-coverage.spec.ts artifacts/studio/e2e/delivery-teaching.spec.ts
```

At `46d2f98` they find:
- `max-coverage.spec.ts:357,364`. Save is located through `workspace-toolbar-row`, which no longer renders on the Input Map, so it must change.
- `delivery-teaching.spec.ts:200`. It asserts `inputMap.getByTestId("button-save")` has count 0, which inverts.
- `workspace-ux-r1-r9.spec.ts:86` (already `pmedian-map-toolbar`, still correct) and `input-map-v2.spec.ts:292` (comment only). Both stay unchanged.

Rewrites:

`max-coverage.spec.ts`, replace lines 356-364 (the comment `// COSM-2 — this model's Save lives in the SHARED toolbar row …` through `const mapSave = page.locator('[data-testid="workspace-toolbar-row"] [data-testid="button-save"]');`) with:

```ts
      // SCU-1.5 (spec B1.2) — this model's Save is INLINE in the Input Map's
      // Layers row again (`saveInLayersRow` lists max-coverage-us), and the
      // shared toolbar row does not render on this view.
      await expect(page.getByTestId("workspace-toolbar-row")).toHaveCount(0);
      const mapSave = page.locator('[data-testid="pmedian-map-toolbar"] [data-testid="button-save"]');
```

Lines 365-367 (`toBeEnabled` / `click` / `toBeDisabled`) are unchanged.

`delivery-teaching.spec.ts`, replace lines 191-200 (comment `// ── 3. Input Map renders fixedGeography: no add/move/delete/Save` through `await expect(inputMap.getByTestId("button-save")).toHaveCount(0);`) with:

```ts
    // ── 3. Input Map renders fixedGeography: no add/move/delete affordance —
    // geometry stays fixed. SCU-1.5 (spec B1.2) — Save IS here now, inline
    // in the Layers row (status/demand edits are real), and the separate
    // shared toolbar row is suppressed on this view ─────────────────────
    await page.getByTestId("sidebar-input-input-map").click();
    const inputMap = page.getByTestId("input-map-tab");
    await expect(inputMap).toBeVisible({ timeout: HEADER_TIMEOUT });
    await expect(inputMap.getByTestId("button-input-map-place-wh")).toHaveCount(0);
    await expect(inputMap.getByTestId("button-input-map-place-cs")).toHaveCount(0);
    await expect(page.getByTestId("pmedian-map-toolbar").getByTestId("button-save")).toHaveCount(1);
    await expect(page.getByTestId("workspace-toolbar-row")).toHaveCount(0);
```

When the servers are up: `E2E_BASE_URL=… pnpm --filter studio exec playwright test e2e/max-coverage.spec.ts e2e/delivery-teaching.spec.ts e2e/workspace-ux-r1-r9.spec.ts`. `delivery-teaching.spec.ts` is also rewritten by SCU-1.2. Those hunks (`:211,225`) do not overlap this one (`:191-200`).

- [ ] **Step 7: Gate**

Run the vitest-count check, then the global gate, each separately. Every command must exit 0.

- [ ] **Step 8: Changelog**

Append `### SCU-1.5 — inline Save for delivery-teaching-us and max-coverage-us`. Record: the `fixedGeography` split (geometry only); `showInlineSave` deleted (deviation 8); COSM-2 inverted for max-coverage-us; the two rewritten e2e specs; the gate counts.

- [ ] **Step 9: Commit**

```bash
[ "$(git rev-parse --abbrev-ref HEAD)" != "main" ] || exit 1
```

```bash
git commit artifacts/studio/src/components/workspace/tabs/InputMapTab.tsx artifacts/studio/src/pages/Workspace.tsx artifacts/studio/src/__tests__/InputMapTab.deliveryFixedGeography.test.tsx artifacts/studio/src/__tests__/Workspace.test.tsx artifacts/studio/e2e/max-coverage.spec.ts artifacts/studio/e2e/delivery-teaching.spec.ts docs/CHANGELOG-implementation.md -m "[SCU-1.5] put Save inline in the Layers row for delivery and max-coverage" -m "fixedGeography now governs geometry only; showInlineSave deleted (deviation 8, no false caller left)." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
## Task SCU-1.6: Sidebar auto open/close (B1.5)

**Owner role:** frontend-engineer. **Spec:** B1.5. **Deviation:** 10. **Depends on:** nothing (wave A).

**Files:**
- Modify: `artifacts/studio/src/components/workspace/SidebarTree.tsx`: `:29-37` (prop), `:78-100` (delete the storage helpers), `:196` (destructure), `:204-217` (state/toggle), `:347` (Scenarios rail icon)
- Modify: `artifacts/studio/src/pages/Workspace.tsx`: after `:2839` (state), `:2883-2889` (`openSolveDialog`), `:4373-4395` (`<SidebarTree>` props)
- Test: `artifacts/studio/src/__tests__/SidebarTree.test.tsx` (`baseProps` `:6-31`; sed; replace `:189-218` and `:320-325`)
- Test: `artifacts/studio/src/__tests__/Workspace.test.tsx` (append a `describe` at EOF)
- e2e: `artifacts/studio/e2e/sidebar-rail.spec.ts:1-15,65-209`; `two-echelon.spec.ts:133-135`; `empty-first-run-workspace.spec.ts:53-68,156-161`
- Modify: `docs/CHANGELOG-implementation.md`

**Interfaces:**
- Consumes: nothing new.
- Produces: `SidebarTree` props `collapsed: boolean` and `onCollapsedChange: (collapsed: boolean) => void`, both required. They replace `defaultCollapsed?: boolean`. The flyout and interacting-row state stay internal. The `nos:sidebar-collapsed` key is never read or written. `Workspace` owns `sidebarCollapsed`, initialised `false` on mount. `openSolveDialog()` sets it `true` when it opens the dialog. That covers the header Run Optimizer and `StaleOutputBanner`'s Run Optimizer, which call the same function (`Workspace.tsx:3935,4079,4363`). `reopenSolveDialog` (the overlay's "Adjust & re-solve") does not collapse it.

- [ ] **Step 0: Invoke the simplicity skills**

Skill tool: `andrej-karpathy-skills:karpathy-guidelines`, then `ponytail:ponytail`.

- [ ] **Step 1: Rewrite `SidebarTree.test.tsx` to the controlled contract (fails now)**

Apply (d), then (c), then (a) and (b). Inserting lines at the top first would shift the quoted line numbers. Each block is also named by its test title.

(a) In `baseProps()` (lines 6-31), add after `hasSolvedRun: false,`:

```ts
    // SCU-1.6 — controlled. `true` keeps every pre-existing test on the
    // collapsed rail it rendered before (the old no-preference default).
    collapsed: true,
    onCollapsedChange: vi.fn(),
```

(b) Rename every `defaultCollapsed=` to `collapsed=`:

```bash
sed -i '' 's/defaultCollapsed=/collapsed=/g' artifacts/studio/src/__tests__/SidebarTree.test.tsx
```

Verify: `grep -c "defaultCollapsed" artifacts/studio/src/__tests__/SidebarTree.test.tsx` → `0`.

(c) Replace lines 189-218. These are the four tests `"renders collapsed when there is no stored preference and no prop"`, `"lets an explicit defaultCollapsed prop win over the stored preference"`, `"uses the stored preference when no prop is supplied"` and `"toggles both ways from the hamburger and persists the choice"`. Replace them with:

```tsx
  // SCU-1.6 (spec B1.5) — collapsed state is CONTROLLED by the parent; the
  // in-component triggers only request a change, and nothing persists.
  it("renders whatever the controlled collapsed prop says", () => {
    const view = render(<SidebarTree {...baseProps()} collapsed={true} />);
    expect(screen.getByTestId("sidebar-tree")).toHaveAttribute("data-collapsed", "true");
    expect(screen.getByTestId("button-toggle-sidebar")).toHaveAttribute("aria-expanded", "false");
    view.rerender(<SidebarTree {...baseProps()} collapsed={false} />);
    expect(screen.getByTestId("sidebar-tree")).toHaveAttribute("data-collapsed", "false");
    expect(screen.getByTestId("button-toggle-sidebar")).toHaveAttribute("aria-expanded", "true");
  });

  it("the hamburger requests expansion from the rail via onCollapsedChange, without changing state itself", async () => {
    const onCollapsedChange = vi.fn();
    render(<SidebarTree {...baseProps()} collapsed={true} onCollapsedChange={onCollapsedChange} />);
    await userEvent.click(screen.getByTestId("button-toggle-sidebar"));
    expect(onCollapsedChange).toHaveBeenCalledWith(false);
    expect(screen.getByTestId("sidebar-tree")).toHaveAttribute("data-collapsed", "true");
  });

  it("the hamburger requests collapse from the expanded panel", async () => {
    const onCollapsedChange = vi.fn();
    render(<SidebarTree {...baseProps()} collapsed={false} onCollapsedChange={onCollapsedChange} />);
    await userEvent.click(screen.getByTestId("button-toggle-sidebar"));
    expect(onCollapsedChange).toHaveBeenCalledWith(true);
  });

  it("never reads or writes the retired nos:sidebar-collapsed preference", async () => {
    window.localStorage.setItem("nos:sidebar-collapsed", "true");
    render(<SidebarTree {...baseProps()} collapsed={false} />);
    // A stored "true" no longer wins over (or even reaches) the prop...
    expect(screen.getByTestId("sidebar-tree")).toHaveAttribute("data-collapsed", "false");
    await userEvent.click(screen.getByTestId("button-toggle-sidebar"));
    // ...and a toggle no longer writes it.
    expect(window.localStorage.getItem("nos:sidebar-collapsed")).toBe("true");
  });
```

(d) Replace lines 320-325 (the test `"expands the whole sidebar when the Scenarios rail icon is activated (D7)"`) with:

```tsx
  it("requests expansion of the whole sidebar when the Scenarios rail icon is activated (D7)", async () => {
    const onCollapsedChange = vi.fn();
    render(<SidebarTree {...baseProps()} collapsed={true} onCollapsedChange={onCollapsedChange} />);
    await userEvent.click(screen.getByTestId("button-open-scenarios-flyout"));
    expect(onCollapsedChange).toHaveBeenCalledWith(false);
  });
```

(e) Append to `Workspace.test.tsx` at EOF:

```tsx

// SCU-1.6 (spec B1.5) — Workspace owns the sidebar's collapsed state:
// expanded on every model-page mount, collapsed when Run Optimizer opens the
// solve dialog, hamburger still toggles, nothing persisted.
describe("Workspace — sidebar auto open/close (SCU-1.6)", () => {
  it("loads with the sidebar EXPANDED and never touches the retired localStorage key", () => {
    const getItem = vi.spyOn(Storage.prototype, "getItem");
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    renderWorkspace();
    expect(screen.getByTestId("sidebar-tree")).toHaveAttribute("data-collapsed", "false");
    expect(getItem.mock.calls.some(([key]) => key === "nos:sidebar-collapsed")).toBe(false);
    expect(setItem.mock.calls.some(([key]) => key === "nos:sidebar-collapsed")).toBe(false);
    getItem.mockRestore();
    setItem.mockRestore();
  });

  it("collapses the sidebar when Run Optimizer opens the solve dialog", () => {
    renderWorkspace();
    fireEvent.click(screen.getByTestId("button-run-optimizer"));
    expect(screen.getByTestId("solve-dialog")).toBeInTheDocument();
    expect(screen.getByTestId("sidebar-tree")).toHaveAttribute("data-collapsed", "true");
  });

  it("the hamburger still toggles both ways", () => {
    renderWorkspace();
    fireEvent.click(screen.getByTestId("button-toggle-sidebar"));
    expect(screen.getByTestId("sidebar-tree")).toHaveAttribute("data-collapsed", "true");
    fireEvent.click(screen.getByTestId("button-toggle-sidebar"));
    expect(screen.getByTestId("sidebar-tree")).toHaveAttribute("data-collapsed", "false");
  });

  it("a fresh mount (model-page load / model switch) starts expanded again after Run Optimizer collapsed it", () => {
    const view = renderWorkspace();
    fireEvent.click(screen.getByTestId("button-run-optimizer"));
    expect(screen.getByTestId("sidebar-tree")).toHaveAttribute("data-collapsed", "true");
    view.unmount();
    renderWorkspace();
    expect(screen.getByTestId("sidebar-tree")).toHaveAttribute("data-collapsed", "false");
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm --filter studio exec vitest run src/__tests__/SidebarTree.test.tsx src/__tests__/Workspace.test.tsx`
Expected: FAIL. Examples: `expected [Function spy] to have been called with [ false ]` (no call), and `expected element to have attribute data-collapsed="false"` (received `"true"`, the old default). `pnpm run typecheck` also fails at this point, because `collapsed`/`onCollapsedChange` are not yet props of `SidebarTree`.

- [ ] **Step 3: Implement — `SidebarTree.tsx`**

Replace lines 29-37 (the SBR-2 `defaultCollapsed` doc + prop) with:

```ts
  /**
   * SCU-1.6 (spec B1.5) — CONTROLLED collapsed state, owned by the parent
   * (Workspace): expanded on every model-page mount, collapsed when Run
   * Optimizer opens the solve dialog. The hamburger and the collapsed
   * Scenarios rail icon only REQUEST a change through `onCollapsedChange`.
   * Nothing is persisted (the old `nos:sidebar-collapsed` key is retired).
   */
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
```

Delete lines 78-100: the comment `// SBR-2 — matches the repo's one existing persistence key …`, `const STORAGE_KEY`, `readStoredCollapsed()` and `writeStoredCollapsed()`.

In the destructuring (line 196), replace `  defaultCollapsed,` with:

```ts
  collapsed,
  onCollapsedChange,
```

Replace lines 204-217:

```ts
  const [collapsed, setCollapsed] = useState<boolean>(
    () => defaultCollapsed ?? readStoredCollapsed() ?? true,
  );

  // The only writer of the persisted preference. SBR-4's Scenarios rail icon
  // calls it too, so there is exactly one persistence path.
  function applyCollapsed(value: boolean) {
    setCollapsed(value);
    writeStoredCollapsed(value);
  }

  function toggleCollapsed() {
    applyCollapsed(!collapsed);
  }
```

with:

```ts
  function toggleCollapsed() {
    onCollapsedChange(!collapsed);
  }
```

At line 347 (the Scenarios rail icon), replace `onClick={() => applyCollapsed(false)}` with `onClick={() => onCollapsedChange(false)}`.

`useState`/`useCallback`/`useEffect`/`useRef` stay imported: `interactingRows` and the flyout still use them.

- [ ] **Step 4: Implement — `Workspace.tsx`**

After line 2839 (`const [solveDialogOpen, setSolveDialogOpen] = useState(false);`), add:

```ts
  // SCU-1.6 (spec B1.5) — the sidebar opens EXPANDED on every model-page
  // mount (App.tsx keys each chapter <Route> by path, so a model switch
  // remounts Workspace and resets this) and collapses when Run Optimizer
  // opens the solve dialog. Not persisted.
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
```

In `openSolveDialog` (lines 2883-2889), replace:

```ts
    if (solvePhase !== "idle") return;
    reopenSolveDialog();
```

with:

```ts
    if (solvePhase !== "idle") return;
    // SCU-1.6 — give the solve flow the width; the hamburger reopens it.
    setSidebarCollapsed(true);
    reopenSolveDialog();
```

In the `<SidebarTree … />` mount (lines 4373-4395), add after `hasSolvedRun={hasFreshSolvedRun}`:

```tsx
          collapsed={sidebarCollapsed}
          onCollapsedChange={setSidebarCollapsed}
```

- [ ] **Step 5: Run them to verify they pass**

Run: `pnpm --filter studio exec vitest run src/__tests__/SidebarTree.test.tsx src/__tests__/Workspace.test.tsx`
Expected: PASS.

- [ ] **Step 6: e2e sweep**

Run these greps now:

```bash
grep -rn "data-collapsed\|button-toggle-sidebar\|button-open-scenarios-flyout\|sidebar-scenarios-flyout\|nos:sidebar-collapsed" artifacts/studio/e2e/
```

At `46d2f98` it finds `sidebar-rail.spec.ts` (whole file), `two-echelon.spec.ts:135`, and `empty-first-run-workspace.spec.ts:61,66,161`. Every one of them assumes the old collapsed-by-default rail.

Rewrites:

`two-echelon.spec.ts`, replace lines 133-135:

```ts
      // SBR — collapsed-by-default sidebar: the clone button is in the rail's
      // Scenarios flyout now, so hover the rail icon first.
      await page.getByTestId("button-open-scenarios-flyout").hover({ timeout: HEADER_TIMEOUT });
```

with:

```ts
      // SCU-1.6 (spec B1.5) — the sidebar loads EXPANDED, so the per-row clone
      // button is directly visible in the Scenarios section.
```

`empty-first-run-workspace.spec.ts`, replace lines 53-68 (the comment `// SBR (review finding 3) — the sidebar now loads COLLAPSED …` through `.toBe("1");`) with:

```ts
    // SCU-1.6 (spec B1.5) — the sidebar loads EXPANDED, so the empty state is
    // painted in the panel itself (no hover flyout, no opacity-0 pill to
    // defeat a bare toBeVisible()).
    const scenariosSection = page.getByTestId("sidebar-section-scenarios");
    await expect(page.getByTestId("sidebar-tree")).toHaveAttribute("data-collapsed", "false");
    const emptyRow = scenariosSection.getByText("No scenarios yet");
    await expect(emptyRow).toBeVisible();
```

Also delete lines 156-161: the comment `// SBR — the sidebar now loads collapsed, …` and the line `await page.getByTestId("button-open-scenarios-flyout").hover({ timeout: HEADER_TIMEOUT });`. The delete and confirm buttons are in the expanded panel.

`sidebar-rail.spec.ts`. Replace the header comment's second line `rail, which ships as the DEFAULT state of every model page.` with `rail. SCU-1.6 (spec B1.5): the sidebar loads EXPANDED on every model page, collapses when Run Optimizer opens the solve dialog, and nothing is persisted.` Then replace lines 65-209 (the whole `test.describe(…)` block) with:

```ts
test.describe("Sidebar rail — expanded on load, collapses on Run Optimizer", () => {
  test("loads expanded, collapses to the rail, reveals exactly one label on hover, does not persist, and Run Optimizer collapses it", async ({ page }) => {
    test.setTimeout(120_000);
    await registerFreshAccount(page, "sbr-rail");
    const id = await createPMedianScenario(page, `E2E SBR rail ${Date.now()}`, 3);

    await page.goto(`/chapter-3?scenario=${id}`);
    await expect(page.getByTestId("workspace-page")).toBeVisible({ timeout: HEADER_TIMEOUT });

    // 1. Expanded is the load state (SCU-1.6).
    const nav = page.getByTestId("sidebar-tree");
    await expect(nav).toHaveAttribute("data-collapsed", "false");
    await expect(page.getByTestId("button-toggle-sidebar")).toHaveAttribute("aria-expanded", "true");
    await expect.poll(async () => navWidth(page), { timeout: HEADER_TIMEOUT }).toBe(224);

    // 2. The hamburger collapses it to the 44px rail.
    await page.getByTestId("button-toggle-sidebar").click({ timeout: HEADER_TIMEOUT });
    await expect(nav).toHaveAttribute("data-collapsed", "true");
    await expect.poll(async () => navWidth(page), { timeout: HEADER_TIMEOUT }).toBe(44);

    // 3. Every entry keeps its testid and stays clickable in the rail.
    await expect(page.getByTestId("sidebar-input-input-map")).toBeVisible();
    await expect(page.getByTestId("sidebar-input-warehouses")).toBeVisible();

    // 4. Hovering ONE rail icon paints ONE label (jsdom cannot check this).
    const warehousesPill = page.getByTestId("sidebar-input-warehouses").locator("span");
    const customersPill = page.getByTestId("sidebar-input-customers").locator("span");
    await page.getByTestId("sidebar-input-warehouses").hover({ timeout: HEADER_TIMEOUT });
    await expect
      .poll(async () => warehousesPill.evaluate(el => getComputedStyle(el).opacity), { timeout: HEADER_TIMEOUT })
      .toBe("1");
    expect(await customersPill.evaluate(el => getComputedStyle(el).opacity)).toBe("0");

    // 5. The pill paints ABOVE the map — asserted with stacking, never
    //    elementFromPoint (the pill is pointer-events-none by design).
    const pillBox = await warehousesPill.boundingBox();
    const mapBox = await page.locator(".leaflet-container").first().boundingBox();
    expect(pillBox).not.toBeNull();
    expect(mapBox).not.toBeNull();
    expect(pillBox!.x + pillBox!.width).toBeGreaterThan(mapBox!.x);
    const stacking = await page.evaluate(() => {
      const navEl = document.querySelector('[data-testid="sidebar-tree"]')!;
      const map = document.querySelector(".leaflet-container")!;
      const navStyle = getComputedStyle(navEl);
      return { navZ: Number(navStyle.zIndex), navPosition: navStyle.position, mapZ: Number(getComputedStyle(map).zIndex) };
    });
    expect(stacking.navPosition).not.toBe("static");
    expect(stacking.navZ).toBeGreaterThan(stacking.mapZ);

    // 6. Not persisted: a reload is a fresh model-page load -> expanded again.
    await page.reload();
    await expect(page.getByTestId("workspace-page")).toBeVisible({ timeout: HEADER_TIMEOUT });
    await expect(page.getByTestId("sidebar-tree")).toHaveAttribute("data-collapsed", "false");

    // 7. Run Optimizer collapses it as it opens the solve dialog.
    await page.getByTestId("button-run-optimizer").click({ timeout: HEADER_TIMEOUT });
    await expect(page.getByTestId("solve-dialog")).toBeVisible({ timeout: HEADER_TIMEOUT });
    await expect(page.getByTestId("sidebar-tree")).toHaveAttribute("data-collapsed", "true");
  });

  test("the map redraws to the new width when the rail toggles", async ({ page }) => {
    test.setTimeout(120_000);
    await registerFreshAccount(page, "sbr-railmap");
    const id = await createPMedianScenario(page, `E2E SBR railmap ${Date.now()}`, 3);

    await page.goto(`/chapter-3?scenario=${id}`);
    await expect(page.getByTestId("workspace-page")).toBeVisible({ timeout: HEADER_TIMEOUT });
    // Input Map is the seeded view on entry, and it is InputMapTab's OWN
    // MapContainer — not NetworkMap's. A fix mounted only in NetworkMap would
    // leave this stale, which is precisely the bug this guards.
    await expect(page.getByTestId("input-map-tab")).toBeVisible({ timeout: HEADER_TIMEOUT });
    await expect(page.getByTestId("sidebar-tree")).toHaveAttribute("data-collapsed", "false");

    const mapWidth = () =>
      page.locator(".leaflet-container").first().evaluate(el => Math.round(el.getBoundingClientRect().width));
    const tileSpan = () =>
      page.evaluate(() => {
        const tiles = [...document.querySelectorAll(".leaflet-tile-loaded")];
        if (!tiles.length) return 0;
        const left = Math.min(...tiles.map(t => t.getBoundingClientRect().left));
        const right = Math.max(...tiles.map(t => t.getBoundingClientRect().right));
        return Math.round(right - left);
      });

    const expandedWidth = await mapWidth();
    await page.getByTestId("button-toggle-sidebar").click({ timeout: HEADER_TIMEOUT });
    await expect(page.getByTestId("sidebar-tree")).toHaveAttribute("data-collapsed", "true");

    // The container must grow by exactly the rail's shrink (224 - 44).
    await expect.poll(async () => await mapWidth(), { timeout: HEADER_TIMEOUT }).toBe(expandedWidth + 180);

    // And Leaflet must have been told about it: tiles have to cover the new
    // container, not the old one (InvalidateOnResize).
    await expect
      .poll(async () => (await tileSpan()) >= (await mapWidth()), { timeout: HEADER_TIMEOUT })
      .toBe(true);
  });

  test("an abandoned delete-confirm does not leave the flyout capturing clicks", async ({ page }) => {
    test.setTimeout(120_000);
    await registerFreshAccount(page, "sbr-railflyout");
    const id = await createPMedianScenario(page, `E2E SBR flyout ${Date.now()}`, 3);

    await page.goto(`/chapter-3?scenario=${id}`);
    await expect(page.getByTestId("workspace-page")).toBeVisible({ timeout: HEADER_TIMEOUT });
    // SCU-1.6 — loads expanded; collapse to the rail to reach the flyout.
    await page.getByTestId("button-toggle-sidebar").click({ timeout: HEADER_TIMEOUT });
    await expect(page.getByTestId("sidebar-tree")).toHaveAttribute("data-collapsed", "true");

    // Start a delete, then walk away without answering.
    await page.getByTestId("button-open-scenarios-flyout").hover({ timeout: HEADER_TIMEOUT });
    await page.getByTestId(`button-delete-scenario-${id}`).click({ timeout: HEADER_TIMEOUT });
    await expect(page.getByTestId("sidebar-scenarios-flyout")).toHaveAttribute("data-pinned", "true");

    // Move the pointer off the rail entirely.
    await page.mouse.move(900, 400);

    // The flyout must release: otherwise a 224px interactive panel stays parked
    // over the content column and swallows clicks on the map beneath it.
    await expect(page.getByTestId("sidebar-scenarios-flyout")).toHaveAttribute("data-pinned", "false");
    await expect(page.getByTestId(`button-confirm-delete-${id}`)).toHaveCount(0);
    await expect
      .poll(async () => opacityOf(page, "sidebar-scenarios-flyout"), { timeout: HEADER_TIMEOUT })
      .toBe("0");

    // The scenario still exists — abandoning the confirm must not delete.
    // After the reload the sidebar is expanded again (not persisted), so the
    // row is directly in the panel.
    await page.reload();
    await expect(page.getByTestId("workspace-page")).toBeVisible({ timeout: HEADER_TIMEOUT });
    await expect(page.getByTestId("sidebar-tree")).toHaveAttribute("data-collapsed", "false");
    await expect(page.getByTestId(`sidebar-scenario-${id}`)).toHaveCount(1);
  });
});
```

Layout risk to watch in SCU-1.10: the content column is 180 px narrower on load than before. That can wrap toolbars in specs that click map canvases at fixed offsets. Those specs use canvas-relative positions, for example `input-map-v2.spec.ts:292-301`. The full gate is the check.

When the servers are up: `E2E_BASE_URL=… pnpm --filter studio exec playwright test e2e/sidebar-rail.spec.ts e2e/two-echelon.spec.ts e2e/empty-first-run-workspace.spec.ts`.

- [ ] **Step 7: Gate**

Run the vitest-count check, then the global gate, each separately. Every command must exit 0.

- [ ] **Step 8: Changelog**

Append `### SCU-1.6 — sidebar expanded on load, collapses on Run Optimizer`. Record: `SidebarTree` is controlled; the `nos:sidebar-collapsed` localStorage key is retired; the default moves from collapsed to expanded (deviation 10, a behaviour change users will notice); the e2e rewrites; the gate counts.

- [ ] **Step 9: Commit**

```bash
[ "$(git rev-parse --abbrev-ref HEAD)" != "main" ] || exit 1
```

```bash
git commit artifacts/studio/src/components/workspace/SidebarTree.tsx artifacts/studio/src/pages/Workspace.tsx artifacts/studio/src/__tests__/SidebarTree.test.tsx artifacts/studio/src/__tests__/Workspace.test.tsx artifacts/studio/e2e/sidebar-rail.spec.ts artifacts/studio/e2e/two-echelon.spec.ts artifacts/studio/e2e/empty-first-run-workspace.spec.ts docs/CHANGELOG-implementation.md -m "[SCU-1.6] make the sidebar controlled: expanded on load, collapsed on Run Optimizer" -m "Retires the nos:sidebar-collapsed localStorage preference; default flips collapsed -> expanded (deviation 10)." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
## Task SCU-1.7: Homepage feedback launcher bottom-right (B1.6)

**Owner role:** frontend-engineer. **Spec:** B1.6. **Depends on:** nothing (wave A).

**Files:**
- Modify: `artifacts/studio/src/components/FeedbackWidget.tsx:55-74` (wrapper alignment + panel anchor + comment)
- Test: `artifacts/studio/src/__tests__/FeedbackWidget.test.tsx` (append inside the top-level `describe`, before its last `});`)
- e2e: `artifacts/studio/e2e/feedback.spec.ts:39-44` (layout assertion)
- Modify: `docs/CHANGELOG-implementation.md`

**Interfaces:**
- Consumes: nothing. `AppShell.tsx:110-124` is unchanged: the widget already sits in the hero-only `homepage-credit-footer`, directly above `<DeveloperCredit />`.
- Produces: no testid changes (`feedback-button`, `feedback-input`, `feedback-send`, `feedback-thanks`).

- [ ] **Step 0: Invoke the simplicity skills**

Skill tool: `andrej-karpathy-skills:karpathy-guidelines`, then `ponytail:ponytail`.

- [ ] **Step 1: Write the failing test**

Append inside `describe("FeedbackWidget", …)` in `FeedbackWidget.test.tsx` (before the file's final `});`):

```tsx

  // SCU-1.7 (spec B1.6) — launcher right-aligned in the footer; the panel
  // opens upward anchored to the RIGHT edge (never centred, which would push
  // it off-screen from a right-hand launcher), width clamped to the viewport.
  // Class-level only — jsdom has no layout; the real geometry is asserted in
  // e2e/feedback.spec.ts.
  it("right-aligns the launcher and anchors the panel to the right edge", async () => {
    const user = userEvent.setup();
    render(<FeedbackWidget />);
    const wrapper = screen.getByTestId("feedback-button").parentElement!;
    expect(wrapper).toHaveClass("justify-end");
    expect(wrapper).not.toHaveClass("justify-center");
    await user.click(screen.getByTestId("feedback-button"));
    const panel = document.getElementById("feedback-panel")!;
    expect(panel).toHaveClass("right-0", "bottom-full", "w-[min(20rem,calc(100vw-2rem))]");
    expect(panel).not.toHaveClass("left-1/2");
    expect(panel).not.toHaveClass("-translate-x-1/2");
  });
```


- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter studio exec vitest run src/__tests__/FeedbackWidget.test.tsx`
Expected: FAIL with `expected element to have class "justify-end"` (received `relative flex justify-center mb-2`).

- [ ] **Step 3: Implement**

In `FeedbackWidget.tsx`, replace line 68:

```tsx
    <div className="relative flex justify-center mb-2" style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
```

with:

```tsx
    <div className="relative flex justify-end mb-2" style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
```

and line 74's class string:

```tsx
          className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 z-20 w-[min(20rem,calc(100vw-2rem))] rounded border bg-background p-3 shadow-lg text-left"
```

with:

```tsx
          className="absolute bottom-full right-0 mb-2 z-20 w-[min(20rem,calc(100vw-2rem))] rounded border bg-background p-3 shadow-lg text-left"
```

Append to the comment block above it (after line 67, `// resizing the footer and shifting the page under the user's cursor.`):

```tsx
    // SCU-1.7 (spec B1.6) — launcher right-aligned (bottom-right of the
    // homepage, directly above DeveloperCredit); the panel anchors `right-0`
    // so it opens upward from the launcher and stays inside the viewport.
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm --filter studio exec vitest run src/__tests__/FeedbackWidget.test.tsx src/__tests__/AppShell.test.tsx`
Expected: PASS. `AppShell.test.tsx:195-209` still proves the launcher is in the footer, not the scroll region.

- [ ] **Step 5: e2e sweep + layout assertion**

Run this grep now: `grep -rn "feedback-button\|feedback-panel\|homepage-credit-footer" artifacts/studio/e2e/`. At `46d2f98` it finds only `feedback.spec.ts:43`, which only clicks the button and is not position-sensitive. Add the spec's layout assertion. In `feedback.spec.ts`, after line 39 (`await page.goto("/");`), insert:

```ts
  // SCU-1.7 (spec B1.6) — the launcher sits bottom-right: its right edge
  // within 32 px of the viewport's right edge, and its bottom above the
  // DeveloperCredit block (the footer's "Developed by Shubham" line).
  const launcher = page.getByTestId("feedback-button");
  await expect(launcher).toBeVisible({ timeout: TIMEOUT });
  const viewport = page.viewportSize();
  const launcherBox = await launcher.boundingBox();
  const creditBox = await page.getByTestId("homepage-credit-footer").getByText("Developed by Shubham").boundingBox();
  expect(viewport).not.toBeNull();
  expect(launcherBox).not.toBeNull();
  expect(creditBox).not.toBeNull();
  expect(viewport!.width - (launcherBox!.x + launcherBox!.width)).toBeLessThanOrEqual(32);
  expect(launcherBox!.y + launcherBox!.height).toBeLessThanOrEqual(creditBox!.y);
```

When the servers are up: `E2E_BASE_URL=… pnpm --filter studio exec playwright test e2e/feedback.spec.ts`.

- [ ] **Step 6: Gate**

Run the vitest-count check, then the global gate, each separately. Every command must exit 0.

- [ ] **Step 7: Changelog**

Append `### SCU-1.7 — feedback launcher bottom-right`. Record the two class changes, the new e2e layout assertion and the gate counts.

- [ ] **Step 8: Commit**

```bash
[ "$(git rev-parse --abbrev-ref HEAD)" != "main" ] || exit 1
```

```bash
git commit artifacts/studio/src/components/FeedbackWidget.tsx artifacts/studio/src/__tests__/FeedbackWidget.test.tsx artifacts/studio/e2e/feedback.spec.ts docs/CHANGELOG-implementation.md -m "[SCU-1.7] move the homepage feedback launcher to the bottom-right" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task SCU-1.8: Opaque Output Map tooltips (B1.7)

**Owner role:** frontend-engineer. **Spec:** B1.7. **Depends on:** nothing (wave A).

**Files:**
- Modify: `artifacts/studio/src/index.css` (insert after the `.leaflet-container { z-index: 0; }` rule, lines 16-18)
- Modify: `artifacts/studio/src/components/NetworkMap.tsx:738-743` (lane), `:801` (customer), `:848` (warehouse), `:866` (plant)
- Test: `artifacts/studio/src/__tests__/NetworkMap.test.tsx:1166-1169` (route tooltip opacity assertion) + a new `describe` at EOF
- Modify: `docs/CHANGELOG-implementation.md`

**Interfaces:**
- Consumes: the CSS tokens `--card`, `--card-foreground`, `--border` (`index.css:287-290`, dark `:454-457`).
- Produces: the class `nos-map-tooltip` on exactly the four `NetworkMap` `<Tooltip>` sites. It is **not** added to `InputMapTab.tsx:2093` or `EntityMarkers.tsx:232-280` (spec "Not added to").

- [ ] **Step 0: Invoke the simplicity skills**

Skill tool: `andrej-karpathy-skills:karpathy-guidelines`, then `ponytail:ponytail`.

- [ ] **Step 1: Write the failing tests**

In `NetworkMap.test.tsx`, the route-tooltip test (`"renders a translucent, pointer-events-none Tooltip on the route polyline …"`, line 1145) asserts translucency at lines 1166-1169. Replace those lines:

```ts
    // translucent (opacity < 1) and pointer-events-none, distinct from the
    // fully-opaque marker Tooltips (opacity={1}) elsewhere in this file.
    expect(routeTooltip!.props.opacity).toBeLessThan(1);
    expect(routeTooltip!.props.className).toContain("pointer-events-none");
```

with:

```ts
    // SCU-1.8 (spec B1.7) — now OPAQUE like the marker tooltips, on the
    // shared solid `nos-map-tooltip` surface; still pointer-events-none.
    expect(routeTooltip!.props.opacity).toBe(1);
    expect(routeTooltip!.props.className).toContain("nos-map-tooltip");
    expect(routeTooltip!.props.className).toContain("pointer-events-none");
```

Rename that test to `"renders an opaque, pointer-events-none Tooltip on the route polyline with cities + distance in the model's unit (default mi)"`.

Append at EOF:

```tsx

// SCU-1.8 (spec B1.7) — every Output Map tooltip (lane, customer, warehouse,
// plant) carries the solid `nos-map-tooltip` class at opacity 1.
describe("NetworkMap — Output Map tooltips are opaque nos-map-tooltip (SCU-1.8)", () => {
  it("lane, customer, warehouse and plant tooltips all carry nos-map-tooltip with opacity 1", () => {
    tooltipCalls.length = 0;
    const tooltipDataset = {
      warehouses: [{ id: "W1", city: "Testville", state: "TS", lat: 40, lng: -90 }],
      customers: [{ id: "C1", city: "Sampleburg", state: "SB", lat: 41, lng: -91, demand: 5000 }],
    };
    const tooltipResult = {
      status: "optimal" as const, objective: 1, runTimeSec: 0.1, quality: "Optimal",
      edges: [{ fromId: "W1", toId: "C1", flow: 5000, distance: 123 }],
      metrics: { weightedAvgDistance: 123, bandCoverage: [], utilizationByNode: [] },
      details: { openWarehouseIds: ["W1"], assignments: [] },
      solverUsed: "CBC (PuLP)", infeasibilityReason: null,
    };
    render(
      <UnitProvider><NetworkMap
        dataset={tooltipDataset}
        warehouseStatuses={[]}
        result={tooltipResult}
        showRoutes={true}
        bands={[200, 400]}
        multiSelectedWarehouseIds={[]}
        multiSelectedCustomerIds={[]}
        onToggleWarehouseMultiSelect={() => {}}
        onToggleCustomerMultiSelect={() => {}}
        plants={[{ id: "P1", city: "Plantown", state: "PL", lat: 42, lng: -92 }]}
        showPlantMarkers={true}
      /></UnitProvider>,
    );
    // The mock records every render, so assert by CONTENT that all four
    // sites were exercised, then that every recorded call is opaque + classed.
    const texts = tooltipCalls.map(c => render(<>{c.children}</>).container.textContent ?? "");
    expect(texts.some(t => t.includes("Testville → Sampleburg"))).toBe(true); // lane
    expect(texts.some(t => t.includes("Customer · C1"))).toBe(true);          // customer
    expect(texts.some(t => t.includes("Warehouse · W1"))).toBe(true);         // warehouse
    expect(texts.some(t => t.includes("Plant · P1"))).toBe(true);             // plant
    for (const call of tooltipCalls) {
      expect(call.props.className).toContain("nos-map-tooltip");
      expect(call.props.opacity).toBe(1);
    }
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm --filter studio exec vitest run src/__tests__/NetworkMap.test.tsx`
Expected: FAIL with `expected 0.85 to be 1` (route) and `expected undefined to contain "nos-map-tooltip"` (markers).

- [ ] **Step 3: Implement**

`index.css`, insert after the `.leaflet-container { z-index: 0; }` rule (after line 18):

```css

/* SCU-1.8 (spec B1.7) — Output Map tooltips: a solid card surface instead of
   Leaflet's default, so a lane/marker label stays readable over a dense map.
   Applied ONLY via NetworkMap's four Output Map <Tooltip className> sites —
   the Input Map's tooltips are deliberately untouched. */
.leaflet-tooltip.nos-map-tooltip {
  background: hsl(var(--card));
  color: hsl(var(--card-foreground));
  border: 1px solid hsl(var(--border));
  box-shadow: 0 2px 8px rgb(0 0 0 / 0.18);
  opacity: 1;
}
```

`NetworkMap.tsx`, lane tooltip (lines 738-743). Replace:

```tsx
                  <Tooltip
                    direction="center"
                    opacity={0.85}
                    className="pointer-events-none"
                    sticky
                  >
```

with:

```tsx
                  <Tooltip
                    direction="center"
                    opacity={1}
                    className="nos-map-tooltip pointer-events-none"
                    sticky
                  >
```

Customer (line 801). Replace `<Tooltip direction="top" offset={[0, -4]} opacity={1}>` with `<Tooltip direction="top" offset={[0, -4]} opacity={1} className="nos-map-tooltip">`.

Warehouse (line 848) and plant (line 866). Each is `<Tooltip direction="top" offset={[0, -10]} opacity={1}>`. Replace both with `<Tooltip direction="top" offset={[0, -10]} opacity={1} className="nos-map-tooltip">`. Verify there are exactly two such lines first (`grep -n 'offset={\[0, -10\]} opacity={1}>' artifacts/studio/src/components/NetworkMap.tsx` → `848`, `866`).

- [ ] **Step 4: Run them to verify they pass**

Run: `pnpm --filter studio exec vitest run src/__tests__/NetworkMap.test.tsx src/__tests__/OutputMapTab.test.tsx`
Expected: PASS.

- [ ] **Step 5: e2e sweep**

Run this grep now: `grep -rn "leaflet-tooltip\|nos-map-tooltip" artifacts/studio/e2e/`. At `46d2f98` it finds `workspace-fixups-2.spec.ts:126,127,132` and `jade-ch9-workspace-bundle.spec.ts:375`. These locate tooltips by `.leaflet-tooltip`, which Leaflet still adds, because the new class is additive. Nothing to rewrite. When the servers are up, run both specs to confirm.

- [ ] **Step 6: Gate**

Run the vitest-count check, then the global gate, each separately. Every command must exit 0.

- [ ] **Step 7: Changelog**

Append `### SCU-1.8 — opaque Output Map tooltips`. Record the CSS rule, the four sites, that the lane opacity goes from 0.85 to 1, the Input Map exclusion and the gate counts.

- [ ] **Step 8: Commit**

```bash
[ "$(git rev-parse --abbrev-ref HEAD)" != "main" ] || exit 1
```

```bash
git commit artifacts/studio/src/index.css artifacts/studio/src/components/NetworkMap.tsx artifacts/studio/src/__tests__/NetworkMap.test.tsx docs/CHANGELOG-implementation.md -m "[SCU-1.8] give Output Map tooltips a solid nos-map-tooltip surface" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
## Task SCU-1.9: Output Map narrative (B1.1)

**Owner role:** frontend-engineer. **Spec:** B1.1, D5. **Deviations:** 2, 3. **Depends on:** SCU-1.1 (`computeExclusiveBandCoverage`, `exclusiveBandLabels`, `bandDecimals`).

**Files:**
- Create: `artifacts/studio/src/lib/resultNarrative.ts`
- Create: `artifacts/studio/src/components/workspace/tabs/OutputMapNarrative.tsx`
- Modify: `artifacts/studio/src/components/workspace/tabs/OutputMapTab.tsx`: imports `:1-14`; delete local `legLabel` `:26-37`; compute narrative after `:221`; render after the map wrapper `:471`
- Test: create `artifacts/studio/src/__tests__/resultNarrative.test.ts`
- Test: `artifacts/studio/src/__tests__/OutputMapTab.test.tsx` (append a `describe` at EOF)
- Modify: `docs/CHANGELOG-implementation.md`

**Field grounding (each path checked in `solve.py`; types in `lib/api-client-react/src/generated/api.schemas.ts:383-509`):**

| Family | Open facilities | Coverage / service | Distance |
|---|---|---|---|
| p-median (`solve.py:492-512`, brazil `:878-880`) | `details.openWarehouseIds` | exclusive bands over `edges` (no `leg`) | `metrics.weightedAvgDistance` |
| transport (`:668-688`) | not narrated as warehouses; distinct `edges[].fromId` = mines, `toId` = stations | exclusive bands over `edges` | `metrics.weightedAvgDistance` |
| max-coverage (`:1630-1642`) | `details.openWarehouseIds` | `details.coveragePct`, `details.coveredDemand`, `details.highServiceDistMi` | `metrics.weightedAvgDistance` |
| delivery (`:1850-1863`) | `details.openWarehouseIds` | exclusive bands, 2 dp; no capacity/utilisation (envelope has no `utilizationByNode`) | `metrics.weightedAvgDistance` |
| gold-au (`:1081-1090`) | `details.openWarehouseIds` (refineries; **no** `metrics.openFacilityIds`) | exclusive bands **per `edges[].leg`** | `metrics.avgDistanceByLeg[]` |
| JADE (`:1411-1424`) | `metrics.openFacilityIds` (warehouses only) | exclusive bands per `edges[].leg` | `metrics.avgDistanceByLeg[]` |

Objective is `result.objective.toLocaleString()` and solve time is `timing.totalSec.toFixed(1)`, the same sources and formats as `output-map-metric-overlay` (`OutputMapTab.tsx:393,444`). A missing field drops its sentence.

**Interfaces:**
- Consumes (from SCU-1.1, `@/lib/bands`): `computeExclusiveBandCoverage`, `exclusiveBandLabels`, `bandDecimals`, `serviceEdgesFor`. From `@/lib/resultOutcome`: `classifyResultOutcome`, `hasIncumbent`, `resultQualityText`.
- Produces (`@/lib/resultNarrative`):
  - `interface NarrativeDistance { toDisplay: (canonical: number) => number; unit: string }`
  - `interface NarrativeContext { bands: number[]; distance: NarrativeDistance | null; solveTimeSec?: number; displayIdById?: Record<string, string> }`
  - `interface ResultNarrative { summary: string[]; howToRead: string }`
  - `buildResultNarrative(modelId: string, result: SolveResult, ctx: NarrativeContext): ResultNarrative | null`. Returns `null` for an unknown model id.
  - `legLabel(leg: string): string`. Moved verbatim from `OutputMapTab.tsx:32-37`.
  - Testids: `output-map-narrative`, `output-map-narrative-summary`, `output-map-narrative-how-to-read`.

- [ ] **Step 0: Invoke the simplicity skills**

Skill tool: `andrej-karpathy-skills:karpathy-guidelines`, then `ponytail:ponytail`.

- [ ] **Step 1: Write the failing narrative tests**

Create `artifacts/studio/src/__tests__/resultNarrative.test.ts`. Every band percentage below was computed by running the SCU-1.1 algorithm on the fixture's edges.

```ts
// SCU-1.9 (spec B1.1) — one test per family, each fixture shaped like that
// family's real solve.py envelope (line refs per fixture). A missing field
// drops its sentence; nothing is invented.
import { describe, it, expect } from "vitest";
import type { SolveResult } from "@workspace/api-client-react";
import { buildResultNarrative, legLabel } from "@/lib/resultNarrative";

const MI = { toDisplay: (v: number) => v, unit: "mi" };
const BANDS = [200, 400, 800, 1600];
const proven = {
  status: "optimal", solutionStatus: "optimal", terminationReason: "optimality_proven", achievedGap: null,
  quality: "optimal", solverUsed: "CBC", infeasibilityReason: null, runTimeSec: 0.4,
};
const asResult = (r: Record<string, unknown>) => ({ ...proven, ...r }) as unknown as SolveResult;

// solve.py:492-512 — p-median: edges carry no `leg`, details.openWarehouseIds.
const pmedian = asResult({
  objective: 29873735731,
  edges: [
    { fromId: "CHI", toId: "C1", flow: 600, distance: 0, band: 0 },
    { fromId: "CHI", toId: "C2", flow: 300, distance: 350, band: 1 },
    { fromId: "ATL", toId: "C3", flow: 100, distance: 900, band: 3 },
  ],
  metrics: { utilizationByNode: [], bandCoverage: [{ band: 200, percent: 60 }, { band: 400, percent: 90 }, { band: 800, percent: 90 }, { band: 1600, percent: 100 }], weightedAvgDistance: 195.0 },
  details: { openWarehouseIds: ["CHI", "ATL"], assignments: [] },
});

describe("buildResultNarrative — p-median", () => {
  it("narrates objective + solve time, open warehouses, exclusive band coverage and weighted distance", () => {
    expect(buildResultNarrative("p-median-us", pmedian, { bands: BANDS, distance: MI, solveTimeSec: 2 })!.summary).toEqual([
      "Objective: 29,873,735,731, solved in 2.0s.",
      "2 warehouses open: CHI, ATL.",
      "Demand by distance band: 0–200 mi 60%, 200–400 mi 30%, 400–800 mi 0%, 800–1600 mi 10%, > 1600 mi 0%.",
      "Weighted average distance: 195.0 mi.",
    ]);
  });

  it("p-median-brazil uses the same adapter", () => {
    expect(buildResultNarrative("p-median-brazil", pmedian, { bands: BANDS, distance: MI })!.summary[1]).toBe("2 warehouses open: CHI, ATL.");
  });

  it("uses display ids when supplied", () => {
    const n = buildResultNarrative("p-median-us", pmedian, { bands: BANDS, distance: MI, displayIdById: { CHI: "WH-IL-CHI" } })!;
    expect(n.summary[1]).toBe("2 warehouses open: WH-IL-CHI, ATL.");
  });

  it("omits the solve time when there is no timing, and every distance sentence while the unit is unresolved", () => {
    expect(buildResultNarrative("p-median-us", pmedian, { bands: BANDS, distance: null })!.summary).toEqual([
      "Objective: 29,873,735,731.",
      "2 warehouses open: CHI, ATL.",
    ]);
  });

  it("drops the open-facility sentence when details.openWarehouseIds is missing (never invented)", () => {
    const n = buildResultNarrative("p-median-us", asResult({ ...pmedian, details: {} }), { bands: BANDS, distance: MI })!;
    expect(n.summary.some(s => s.includes("open"))).toBe(false);
  });

  it("a no-incumbent result gets one truthful sentence and nothing derived from its sentinel zeros", () => {
    const infeasible = asResult({ ...pmedian, status: "infeasible", solutionStatus: "infeasible", terminationReason: null, objective: 0, edges: [] });
    expect(buildResultNarrative("p-median-us", infeasible, { bands: BANDS, distance: MI })!.summary).toEqual([
      "There is no solution to describe (No incumbent).",
    ]);
  });

  it("returns null for a model it has no adapter for", () => {
    expect(buildResultNarrative("not-a-model", pmedian, { bands: BANDS, distance: MI })).toBeNull();
  });
});

// solve.py:668-688 — transport: details.openWarehouseIds holds MINES, so the
// adapter narrates mine -> station flows instead of "warehouses".
describe("buildResultNarrative — transport", () => {
  const transport = asResult({
    objective: 123456,
    edges: [
      { fromId: "M1", toId: "S1", flow: 500, distance: 120, band: 0 },
      { fromId: "M1", toId: "S2", flow: 300, distance: 450, band: 2 },
      { fromId: "M2", toId: "S2", flow: 200, distance: 90, band: 0 },
    ],
    metrics: { utilizationByNode: [], bandCoverage: [{ band: 200, percent: 70 }, { band: 400, percent: 70 }, { band: 800, percent: 100 }, { band: 1600, percent: 100 }], weightedAvgDistance: 213.0 },
    details: { openWarehouseIds: ["M1", "M2"], assignments: [] },
  });

  it("narrates mine -> station flows, never 'warehouses'", () => {
    const n = buildResultNarrative("transport-coal", transport, { bands: BANDS, distance: MI })!;
    expect(n.summary).toEqual([
      "Objective: 123,456.",
      "Coal ships from 2 mines to 2 power stations over 3 lanes.",
      "Tonnage by distance band: 0–200 mi 70%, 200–400 mi 0%, 400–800 mi 30%, 800–1600 mi 0%, > 1600 mi 0%.",
      "Weighted average distance: 213.0 mi.",
    ]);
    expect(n.summary.join(" ")).not.toMatch(/warehouse/i);
    expect(n.howToRead).toMatch(/mines/);
  });
});

// solve.py:1630-1642 — max-coverage: coverage is details.coveragePct /
// coveredDemand against details.highServiceDistMi (not a band rollup).
describe("buildResultNarrative — max-coverage", () => {
  const maxCoverage = asResult({
    objective: 66.6667,
    edges: [{ fromId: "W1", toId: "C1", flow: 100, distance: 300 }],
    metrics: { openFacilityIds: ["W1", "W2", "W3"], weightedAvgDistance: 812.4, utilizationByNode: [], bandCoverage: [{ band: 450, percent: 66.6667 }, { band: 3400, percent: 100 }] },
    details: { objective: "coverage", p: 3, highServiceDistMi: 450, maxDistMi: 3400, coverageFloorDemand: 0, openWarehouseIds: ["W1", "W2", "W3"], coveragePct: 66.6667, coveredDemand: 131645389, uncoveredPct: 33.3333, assignments: [] },
  });

  it("narrates coverage from coveragePct/coveredDemand at the high-service distance", () => {
    expect(buildResultNarrative("max-coverage-us", maxCoverage, { bands: [450, 900, 1800, 3400], distance: MI })!.summary).toEqual([
      "Objective: 66.667.",
      "3 warehouses open: W1, W2, W3.",
      "66.67% of demand (131,645,389 units) is within the 450.0 mi high-service distance.",
      "Weighted average distance: 812.4 mi.",
    ]);
  });
});

// solve.py:1850-1863 — delivery: 2-dp bands, no utilizationByNode (no
// capacity), details.objective "base"/"cost_adjusted".
describe("buildResultNarrative — delivery", () => {
  const delivery = asResult({
    objective: 88240913478.1,
    edges: [
      { fromId: "W1", toId: "C1", flow: 2, distance: 0, band: 0 },
      { fromId: "W2", toId: "C2", flow: 1, distance: 900, band: 2 },
    ],
    metrics: { bandCoverage: [{ band: 400, percent: 66.67 }, { band: 800, percent: 66.67 }, { band: 1200, percent: 100 }, { band: 1600, percent: 100 }], weightedAvgDistance: 422.5511, openFacilityIds: ["W1", "W2", "W60"] },
    details: { openWarehouseIds: ["W1", "W2", "W60"], assignments: [], objective: "base" },
  });

  it("narrates 2-dp exclusive bands and no capacity/utilisation text", () => {
    const n = buildResultNarrative("delivery-teaching-us", delivery, { bands: [400, 800, 1200, 1600], distance: MI })!;
    expect(n.summary).toEqual([
      "Objective: 88,240,913,478.1.",
      "3 warehouses open: W1, W2, W60.",
      "Demand by distance band: 0–400 mi 66.67%, 400–800 mi 0%, 800–1200 mi 33.33%, 1200–1600 mi 0%, > 1600 mi 0%.",
      "Weighted average distance: 422.6 mi.",
    ]);
    expect(n.summary.join(" ")).not.toMatch(/capacity|utili/i);
  });
});

// two-echelon — gold-au (solve.py:1081-1090: refineries in
// details.openWarehouseIds, NO metrics.openFacilityIds) and JADE
// (solve.py:1411-1424: metrics.openFacilityIds = warehouses only).
describe("buildResultNarrative — two-echelon", () => {
  const gold = asResult({
    objective: 98765.43,
    edges: [
      { fromId: "MINE1", toId: "REF1", flow: 1000, distance: 1464.5, band: 3, leg: "mine_to_refinery" },
      { fromId: "REF1", toId: "C1", flow: 600, distance: 100, band: 0, leg: "refinery_to_customer" },
      { fromId: "REF1", toId: "C2", flow: 400, distance: 250, band: 1, leg: "refinery_to_customer" },
    ],
    metrics: {
      utilizationByNode: [], bandCoverage: [{ band: 200, percent: 60 }, { band: 400, percent: 100 }, { band: 800, percent: 100 }, { band: 1600, percent: 100 }],
      weightedAvgDistance: 812.3,
      avgDistanceByLeg: [{ leg: "mine_to_refinery", avgDistance: 1464.5, totalFlow: 1000 }, { leg: "refinery_to_customer", avgDistance: 160.0, totalFlow: 1000 }],
    },
    details: { openWarehouseIds: ["REF1"], assignments: [], bomRatio: 1.1 },
  });

  it("gold-au: open refineries from details.openWarehouseIds, per-leg bands and per-leg averages", () => {
    expect(buildResultNarrative("two-echelon-gold-au", gold, { bands: BANDS, distance: MI })!.summary).toEqual([
      "Objective: 98,765.43.",
      "1 refinery open: REF1.",
      "Mine → Refinery flow by distance band: 0–200 mi 0%, 200–400 mi 0%, 400–800 mi 0%, 800–1600 mi 100%, > 1600 mi 0%.",
      "Refinery → Customer flow by distance band: 0–200 mi 60%, 200–400 mi 40%, 400–800 mi 0%, 800–1600 mi 0%, > 1600 mi 0%.",
      "Average Mine → Refinery distance: 1464.5 mi.",
      "Average Refinery → Customer distance: 160.0 mi.",
    ]);
  });

  const jade = asResult({
    objective: 4567890.1234,
    edges: [
      { fromId: "P1", toId: "wh-11", flow: 700, distance: 300, leg: "plant_to_warehouse", productId: "product-1" },
      { fromId: "P2", toId: "wh-14", flow: 300, distance: 900, leg: "plant_to_warehouse", productId: "product-2" },
      { fromId: "wh-11", toId: "c1", flow: 600, distance: 150, band: 0, leg: "warehouse_to_customer" },
      { fromId: "wh-14", toId: "c2", flow: 400, distance: 500, band: 2, leg: "warehouse_to_customer" },
    ],
    metrics: {
      utilizationByNode: [], bandCoverage: [{ band: 200, percent: 60 }, { band: 400, percent: 0 }, { band: 800, percent: 40 }, { band: 1600, percent: 0 }],
      weightedAvgDistance: 385.0, openFacilityIds: ["wh-11", "wh-14"], totalDemand: 1000, inboundCost: 1, outboundCost: 2,
      avgDistanceByLeg: [{ leg: "plant_to_warehouse", avgDistance: 480.0, totalFlow: 1000 }, { leg: "warehouse_to_customer", avgDistance: 290.0, totalFlow: 1000 }],
    },
    details: { openWarehouseIds: ["wh-11", "wh-14"], assignments: [] },
  });

  it("JADE: open warehouses from metrics.openFacilityIds; plants are never narrated as 'open'", () => {
    const n = buildResultNarrative("two-echelon-jade-us", jade, { bands: BANDS, distance: MI })!;
    expect(n.summary).toEqual([
      "Objective: 4,567,890.123.",
      "2 warehouses open: wh-11, wh-14.",
      "Plant → Warehouse flow by distance band: 0–200 mi 0%, 200–400 mi 70%, 400–800 mi 0%, 800–1600 mi 30%, > 1600 mi 0%.",
      "Warehouse → Customer flow by distance band: 0–200 mi 60%, 200–400 mi 0%, 400–800 mi 40%, 800–1600 mi 0%, > 1600 mi 0%.",
      "Average Plant → Warehouse distance: 480.0 mi.",
      "Average Warehouse → Customer distance: 290.0 mi.",
    ]);
    expect(n.summary.join(" ")).not.toMatch(/plants? open/i);
  });
});

describe("buildResultNarrative — 'How to read this map'", () => {
  it("every supported model has fixed, non-empty reading guidance mentioning the band legend", () => {
    for (const id of ["p-median-us", "p-median-brazil", "transport-coal", "max-coverage-us", "delivery-teaching-us", "two-echelon-gold-au", "two-echelon-jade-us"]) {
      const n = buildResultNarrative(id, pmedian, { bands: BANDS, distance: MI })!;
      expect(n.howToRead, id).toMatch(/legend/);
    }
  });
});

describe("legLabel (moved from OutputMapTab)", () => {
  it("derives a label from the leg string itself", () => {
    expect(legLabel("plant_to_warehouse")).toBe("Plant → Warehouse");
    expect(legLabel("mine_to_refinery")).toBe("Mine → Refinery");
    expect(legLabel("custom")).toBe("Custom");
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm --filter studio exec vitest run src/__tests__/resultNarrative.test.ts`
Expected: FAIL with `Failed to resolve import "@/lib/resultNarrative"`.

- [ ] **Step 3: Implement `lib/resultNarrative.ts`**

Create `artifacts/studio/src/lib/resultNarrative.ts`:

```ts
import type { Edge, SolveResult } from "@workspace/api-client-react";
import { bandDecimals, computeExclusiveBandCoverage, exclusiveBandLabels, serviceEdgesFor } from "@/lib/bands";
import { classifyResultOutcome, hasIncumbent, resultQualityText } from "@/lib/resultOutcome";

// SCU-1.9 (spec B1.1) — the Output Map's plain-language reading of the
// DISPLAYED result. One adapter per model family reads that family's real
// envelope fields (solve.py refs in the plan's grounding table); a missing
// field drops its sentence, it is never invented. Band coverage is the
// EXCLUSIVE lens (SCU-1.1) over the same bands the map colours with.

type Family = "pmedian" | "transport" | "maxCoverage" | "delivery" | "twoEchelon";

const FAMILY_BY_MODEL: Record<string, Family> = {
  "p-median-us": "pmedian",
  "p-median-brazil": "pmedian",
  "transport-coal": "transport",
  "max-coverage-us": "maxCoverage",
  "delivery-teaching-us": "delivery",
  "two-echelon-gold-au": "twoEchelon",
  "two-echelon-jade-us": "twoEchelon",
};

const WAREHOUSE_MAP_GUIDE =
  "Triangles are warehouses and circles are customers. Each line joins a customer to the warehouse that serves it and is coloured by its distance band; the legend shows which colour is which band. Untick “Color lanes: Distance band” to draw every lane in one colour, or use the Warehouses, Customers and Lanes checkboxes to hide a layer.";

// Fixed per-model "How to read this map" text (spec B1.1, second paragraph).
const HOW_TO_READ: Record<string, string> = {
  "p-median-us": WAREHOUSE_MAP_GUIDE,
  "p-median-brazil": WAREHOUSE_MAP_GUIDE,
  "max-coverage-us": WAREHOUSE_MAP_GUIDE,
  "delivery-teaching-us": WAREHOUSE_MAP_GUIDE,
  "transport-coal":
    "Triangles are mines and circles are power stations. Each line is a coal shipment from a mine to a station, coloured by its distance band; the legend shows which colour is which band. Use the checkboxes above the map to hide a layer or to draw every lane in one colour.",
  "two-echelon-gold-au":
    "The star is the mine, triangles are refineries and circles are customers. Lanes run mine → refinery and refinery → customer; use the leg checkboxes above the map to show one leg at a time. Lanes are coloured by distance band (see the legend); untick “Color lanes: Distance band” to colour them by leg instead.",
  "two-echelon-jade-us":
    "Squares are plants, triangles are warehouses and circles are customers. Lanes run plant → warehouse and warehouse → customer; use the leg checkboxes above the map to show one leg at a time. Lanes are coloured by distance band (see the legend); untick “Color lanes: Distance band” to colour them by leg instead.",
};

export interface NarrativeDistance {
  /** canonical -> display-unit number */
  toDisplay: (canonical: number) => number;
  /** display unit label, e.g. "mi" */
  unit: string;
}

export interface NarrativeContext {
  /** The band lens the map colours with (OutputMapTab's effectiveBands). */
  bands: number[];
  /** null while the model's canonical unit is unresolved -> no distance sentences. */
  distance: NarrativeDistance | null;
  /** The overlay's timing.totalSec, when the caller has it. */
  solveTimeSec?: number;
  displayIdById?: Record<string, string>;
}

export interface ResultNarrative {
  summary: string[];
  howToRead: string;
}

// jade-T15.6 — derives a human-readable lane label from a leg string value
// itself (e.g. "plant_to_warehouse" -> "Plant → Warehouse"), never from a
// modelId/leg-string allowlist. Moved here from OutputMapTab.tsx (SCU-1.9)
// so the narrative and the leg toggles share one copy.
export function legLabel(leg: string): string {
  const parts = leg.split("_to_");
  const cap = (s: string) => (s.length > 0 ? s.charAt(0).toUpperCase() + s.slice(1) : s);
  if (parts.length === 2) return `${cap(parts[0])} → ${cap(parts[1])}`;
  return cap(leg);
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

function stringIds(value: unknown): string[] | null {
  return Array.isArray(value) && value.every(v => typeof v === "string") ? (value as string[]) : null;
}

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Same format as the metric overlay's showDistance (OutputMapTab.tsx:203-206). */
function formatDistance(canonical: number, d: NarrativeDistance): string {
  return `${d.toDisplay(canonical).toFixed(1)} ${d.unit}`;
}

function distinctLegs(edges: Edge[]): string[] {
  const seen: string[] = [];
  for (const e of edges) if (e.leg != null && !seen.includes(e.leg)) seen.push(e.leg);
  return seen;
}

function bandSentence(prefix: string, edges: Edge[], bands: number[], decimals: number, d: NarrativeDistance): string | null {
  if (edges.length === 0) return null;
  const rows = computeExclusiveBandCoverage(edges, bands, decimals);
  if (rows.length === 0) return null;
  const fmt = (v: number) => d.toDisplay(v).toLocaleString(undefined, { maximumFractionDigits: 4, useGrouping: false });
  // rows = sorted boundaries, then the overflow row (always last).
  const labels = exclusiveBandLabels(rows.slice(0, -1).map(r => r.band), fmt, d.unit);
  return `${prefix}${rows.map((r, i) => `${labels[i]} ${r.percent}%`).join(", ")}.`;
}

export function buildResultNarrative(modelId: string, result: SolveResult, ctx: NarrativeContext): ResultNarrative | null {
  const family = FAMILY_BY_MODEL[modelId];
  if (!family) return null;
  const howToRead = HOW_TO_READ[modelId];

  // A no-incumbent result carries sentinel zeros (resultOutcome.ts) — say so
  // truthfully and derive nothing from them.
  if (!hasIncumbent(classifyResultOutcome(result))) {
    return { summary: [`There is no solution to describe (${resultQualityText(result)}).`], howToRead };
  }

  const details = (result.details ?? {}) as Record<string, unknown>;
  const label = (id: string) => ctx.displayIdById?.[id] ?? id;
  const d = ctx.distance;
  const summary: string[] = [
    `Objective: ${result.objective.toLocaleString()}${ctx.solveTimeSec != null ? `, solved in ${ctx.solveTimeSec.toFixed(1)}s` : ""}.`,
  ];

  if (family === "transport") {
    // details.openWarehouseIds holds MINES here (solve.py:687) — narrate the
    // shipments instead of calling anything a warehouse.
    if (result.edges.length > 0) {
      const mines = new Set(result.edges.map(e => e.fromId)).size;
      const stations = new Set(result.edges.map(e => e.toId)).size;
      const lanes = result.edges.length;
      summary.push(
        `Coal ships from ${mines} ${plural(mines, "mine", "mines")} to ${stations} ${plural(stations, "power station", "power stations")} over ${lanes} ${plural(lanes, "lane", "lanes")}.`,
      );
    }
  } else {
    // Two-echelon (deviation 2): JADE reports metrics.openFacilityIds
    // (warehouses only); gold-au reports only details.openWarehouseIds
    // (refineries). Plants/mines are never facility decisions.
    const ids = family === "twoEchelon"
      ? (result.metrics.openFacilityIds ?? stringIds(details.openWarehouseIds))
      : stringIds(details.openWarehouseIds);
    if (ids) {
      const [one, many] = modelId === "two-echelon-gold-au" ? ["refinery", "refineries"] : ["warehouse", "warehouses"];
      summary.push(`${ids.length} ${plural(ids.length, one, many)} open${ids.length > 0 ? `: ${ids.map(label).join(", ")}` : ""}.`);
    }
  }

  if (d) {
    if (family === "maxCoverage") {
      const pct = finite(details.coveragePct);
      const covered = finite(details.coveredDemand);
      const highService = finite(details.highServiceDistMi);
      if (pct != null && covered != null && highService != null) {
        summary.push(`${pct.toFixed(2)}% of demand (${covered.toLocaleString()} units) is within the ${formatDistance(highService, d)} high-service distance.`);
      }
    } else if (family === "twoEchelon") {
      for (const leg of distinctLegs(result.edges)) {
        const s = bandSentence(`${legLabel(leg)} flow by distance band: `, result.edges.filter(e => e.leg === leg), ctx.bands, bandDecimals(modelId), d);
        if (s) summary.push(s);
      }
    } else {
      const prefix = family === "transport" ? "Tonnage by distance band: " : "Demand by distance band: ";
      const s = bandSentence(prefix, serviceEdgesFor(result.edges), ctx.bands, bandDecimals(modelId), d);
      if (s) summary.push(s);
    }

    const byLeg = result.metrics.avgDistanceByLeg ?? [];
    if (family === "twoEchelon" && byLeg.length > 0) {
      for (const l of byLeg) summary.push(`Average ${legLabel(l.leg)} distance: ${formatDistance(l.avgDistance, d)}.`);
    } else if (result.metrics.weightedAvgDistance != null) {
      summary.push(`Weighted average distance: ${formatDistance(result.metrics.weightedAvgDistance, d)}.`);
    }
  }

  return { summary, howToRead };
}
```

- [ ] **Step 4: Run them to verify they pass**

Run: `pnpm --filter studio exec vitest run src/__tests__/resultNarrative.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing OutputMapTab tests**

Append to `artifacts/studio/src/__tests__/OutputMapTab.test.tsx`:

```tsx

// SCU-1.9 (spec B1.1, D5) — the narrative renders below the map only when the
// tab renders a result. (Stale never reaches this component: Workspace's
// StaleOutputBanner gate, Workspace.tsx:3934-3936, is unchanged — D5.)
describe("OutputMapTab — result narrative (SCU-1.9)", () => {
  it("renders no narrative when there is no solved result", () => {
    render(<OutputMapTab dataset={dataset} warehouseStatuses={[]} result={null} bands={[]} modelId="p-median-us" />);
    expect(screen.queryByTestId("output-map-narrative")).not.toBeInTheDocument();
  });

  it("renders the narrative below the map for a solved result, over the map's own band lens", () => {
    const { container } = render(
      <OutputMapTab dataset={dataset} warehouseStatuses={[]} result={result} bands={[250, 500, 750]} modelId="p-median-us" />,
    );
    const narrative = screen.getByTestId("output-map-narrative");
    // fixture: W1 open; 50 flow at 100 mi (band 0) + 50 flow at 900 mi (overflow).
    expect(narrative).toHaveTextContent("1 warehouse open: W1.");
    expect(narrative).toHaveTextContent("Demand by distance band: 0–250 mi 50%, 250–500 mi 0%, 500–750 mi 0%, > 750 mi 50%.");
    expect(narrative).toHaveTextContent("Weighted average distance: 500.0 mi.");
    expect(screen.getByTestId("output-map-narrative-how-to-read")).toHaveTextContent("How to read this map:");
    const map = container.querySelector(".leaflet-container")!;
    expect(map.contains(narrative)).toBe(false);
    expect(map.compareDocumentPosition(narrative) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("renders no narrative for a model with no adapter", () => {
    render(<OutputMapTab dataset={dataset} warehouseStatuses={[]} result={result} bands={[]} />);
    expect(screen.queryByTestId("output-map-narrative")).not.toBeInTheDocument();
  });
});
```

Run: `pnpm --filter studio exec vitest run src/__tests__/OutputMapTab.test.tsx`
Expected: FAIL with `Unable to find an element by: [data-testid="output-map-narrative"]`.

- [ ] **Step 6: Implement the component and mount it**

Create `artifacts/studio/src/components/workspace/tabs/OutputMapNarrative.tsx`:

```tsx
import type { ResultNarrative } from "@/lib/resultNarrative";

// SCU-1.9 (spec B1.1) — plain-language reading of the displayed result,
// rendered below the Output Map. Presentational only: the text comes from
// buildResultNarrative (lib/resultNarrative.ts).
export function OutputMapNarrative({ narrative }: { narrative: ResultNarrative }) {
  return (
    <section
      data-testid="output-map-narrative"
      aria-label="About this result"
      className="flex-shrink-0 max-h-40 overflow-y-auto rounded-md border bg-card px-3 py-2 text-xs leading-relaxed space-y-1.5"
    >
      <p data-testid="output-map-narrative-summary">{narrative.summary.join(" ")}</p>
      <p data-testid="output-map-narrative-how-to-read" className="text-muted-foreground">
        <span className="font-medium text-foreground">How to read this map: </span>
        {narrative.howToRead}
      </p>
    </section>
  );
}
```

`OutputMapTab.tsx`:
- After line 14 (`import { FloorExceedsMaxAlert } …`), add:

```ts
import { buildResultNarrative, legLabel } from "@/lib/resultNarrative";
import { OutputMapNarrative } from "@/components/workspace/tabs/OutputMapNarrative";
```

- Delete lines 26-37 (the `// jade-T15.6 — derives a human-readable lane label …` comment and the local `function legLabel`). The two call sites (`:360`, `:407`) now use the import.
- After line 221 (`const showIncumbent = …;`), add:

```ts
  // SCU-1.9 (spec B1.1) — the narrative reads the SAME band lens the lanes
  // are coloured with (effectiveBands, not mapBands: unticking "Color lanes"
  // must not empty the coverage sentence) and the overlay's solve time.
  const narrative =
    result && modelId
      ? buildResultNarrative(modelId, result, {
          bands: effectiveBands,
          distance: distanceUnit == null
            ? null
            : { toDisplay: v => unit.toDisplay(v, distanceUnit), unit: unit.effectiveUnit(distanceUnit) },
          solveTimeSec: timing?.totalSec,
          displayIdById,
        })
      : null;
```

- Immediately after the map wrapper's closing `</div>` (line 471, which closes `<div className="flex-1 min-h-0 relative" ref={mapRef}>`), and before the tab's final `</div>`, add:

```tsx
      {narrative && <OutputMapNarrative narrative={narrative} />}
```

The narrative sits outside `mapRef`, so Copy and Download PNG capture the map only.

- [ ] **Step 7: Run them to verify they pass**

Run: `pnpm --filter studio exec vitest run src/__tests__/OutputMapTab.test.tsx src/__tests__/resultNarrative.test.ts src/__tests__/Workspace.OutputMap.test.tsx src/__tests__/Workspace.StaleOutputs.test.tsx`
Expected: PASS. `Workspace.StaleOutputs.test.tsx` covers D5: a stale scenario still renders `StaleOutputBanner`, never the tab.

- [ ] **Step 8: e2e sweep**

Run these greps now:

```bash
grep -rn "output-map-narrative\|output-map-tab\|output-map-metric-overlay" artifacts/studio/e2e/ | wc -l
grep -rn "output-map-metric-overlay" artifacts/studio/e2e/
```

This task adds DOM and changes no existing testid or string, so no assertion can break by name. The second grep returns nothing at `46d2f98`. The one real risk is layout: the narrative takes up to `max-h-40` (160 px) below the map, which makes the Output Map shorter. When the servers are up, run the specs that interact with Output Map markers or lanes: `E2E_BASE_URL=… pnpm --filter studio exec playwright test e2e/workspace-fixups-2.spec.ts e2e/jade-ch9-workspace-bundle.spec.ts e2e/nonjade-servicestats-live-coverage.spec.ts e2e/workspace-ux-r1-r9.spec.ts`. If a marker hover or click misses because the map shrank, fix the spec's locator to target the marker element (never a fixed page coordinate). Record the outcome.

- [ ] **Step 9: Gate**

Run the vitest-count check, then the global gate, each separately. Every command must exit 0.

- [ ] **Step 10: Changelog**

Append `### SCU-1.9 — Output Map narrative`. Record: the per-family adapters with the grounding table, deviations 2 and 3, the D5 gate kept, `legLabel` moved, and the gate counts.

- [ ] **Step 11: Commit**

```bash
git add artifacts/studio/src/lib/resultNarrative.ts artifacts/studio/src/components/workspace/tabs/OutputMapNarrative.tsx artifacts/studio/src/__tests__/resultNarrative.test.ts
```

```bash
[ "$(git rev-parse --abbrev-ref HEAD)" != "main" ] || exit 1
```

```bash
git commit artifacts/studio/src/lib/resultNarrative.ts artifacts/studio/src/components/workspace/tabs/OutputMapNarrative.tsx artifacts/studio/src/components/workspace/tabs/OutputMapTab.tsx artifacts/studio/src/__tests__/resultNarrative.test.ts artifacts/studio/src/__tests__/OutputMapTab.test.tsx docs/CHANGELOG-implementation.md -m "[SCU-1.9] add a plain-language narrative below the Output Map" -m "Deviation 2: gold-au open refineries come from details.openWarehouseIds; JADE openFacilityIds are warehouses only. Deviation 3: buildResultNarrative takes a ctx (bands, distance, solve time, display ids)." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
## Task SCU-1.10: Real-browser QA + full e2e gate (qa-sdet)

**Owner role:** qa-sdet. It is **exempt** from karpathy and ponytail (hard rule #12). If a ponytail ruleset is injected anyway, ignore it and say so in the report. The review is a separate `fable` reviewer (AGENTS.md). **Depends on:** SCU-1.1 through SCU-1.9, all cherry-picked onto `scnd-upgrades` with the bundle gate green.

**Files:**
- Modify (only if the run requires it): `artifacts/studio/e2e/*.spec.ts`. Use this for spec-only repairs, never product code.
- Modify: `docs/superpowers/flake-registry.md` (new sightings only, matched by test **name**)
- Modify: `docs/CHANGELOG-implementation.md`

**Interfaces:**
- Consumes: the whole bundle and the local two-server recipe (`artifacts/studio/e2e/CLAUDE.md`).
- Produces: a QA verdict per B1 item, a full `pnpm e2e:gate` result and a flake record. A **product** defect found here is not fixed here. Report it to the lead with repro steps, a screenshot and the failing assertion, and the owning SCU task is reopened on its own branch.

- [ ] **Step 1: Worktree + base guard**

`cd /Users/shubhamkr/nos-scu-1.10 && git rev-parse --abbrev-ref HEAD` must print `scu-1.10-work`. Then run `git merge-base --is-ancestor <wave-C tip> HEAD`. STOP if it fails.

- [ ] **Step 2: Start the two local servers** (recipe in `artifacts/studio/e2e/CLAUDE.md`, verbatim)

Terminal A (background):

```bash
DATABASE_URL="postgresql://shubhamkr@localhost:5432/nos_dev" PORT=3001 pnpm --filter api-server run dev
```

Terminal B (background). Pick a free studio port, e.g. 5180:

```bash
PORT=5180 BASE_PATH=/ API_PROXY_TARGET=http://localhost:3001 VITE_POSTHOG_KEY=phc_local_dummy_key VITE_SENTRY_DSN=https://x@o.ingest.sentry.io/1 pnpm --filter studio run dev
```

Wait for both to answer: `curl -sf http://localhost:3001/api/healthz` and `curl -sf http://localhost:5180/`.

- [ ] **Step 3: Real-browser pass, every B1 item, every affected model**

Drive a real Chromium (Playwright headed, or the claude-in-chrome tools) against `http://localhost:5180`. Use a fresh account. For each row, record pass or fail plus one screenshot in the QA report. A row passes only when the stated observation is seen. "No error" is not an observation.

| Item | Models | Observe |
|---|---|---|
| B1.1 narrative | p-median-us, p-median-brazil, transport-coal, max-coverage-us, delivery-teaching-us, two-echelon-gold-au, two-echelon-jade-us | Solve, then open Output Map. `output-map-narrative` sits below the map. Its open-facility noun is right: refineries for gold-au; mines → stations for transport; never "plants open" for JADE. Its band percentages match the Service Stats rows for the same bands. Edit an input and save without re-solving: `StaleOutputBanner` shows and there is no narrative (D5). |
| B1.2 Save inline | delivery-teaching-us, max-coverage-us (+ p-median-us regression) | On the Input Map, `button-save` sits at the right end of the `Layers:` row, vertically centred with the checkboxes, and `workspace-toolbar-row` is absent. Edit a warehouse status via the map: Save enables, a click persists it, and a reload shows the status kept. Delivery still offers no add/move/copy/delete. |
| B1.3 Summary bar | p-median-us (2 scenarios), two-echelon-jade-us (2 scenarios) | No "Solution Summary" title. A green `Compare Scenario` button sits left and Download CSV right. The picker is hidden until the button is clicked. Select a second scenario: Download CSV downloads `cost-summary-compare.csv` (capture the Playwright `download` event). Its rows equal the on-screen rows in order, its values are raw, and a row missing for one scenario is an empty cell. |
| B1.4 titles | p-median-us (Open Warehouses, Customer Assignments, Service Stats), transport-coal (Flows), two-echelon-jade-us (Customer Assignments, Flows) | No title that repeats the tab name. Download sits right-aligned. The JADE Flows segmented control is still at the left. |
| B1.5 sidebar | p-median-us, then switch to two-echelon-jade-us | The sidebar is expanded on load. Run Optimizer collapses it as the solve dialog opens. The hamburger toggles both ways. A reload, and a switch to another chapter, both load expanded again. |
| B1.6 feedback | homepage `/`, at 1280×720 and at 375×812 | The launcher's right edge is within 32 px of the viewport's right edge, above "Developed by Shubham". The panel opens upward and stays fully inside the viewport at both widths. |
| B1.7 tooltips | p-median-us (lane, customer, warehouse), two-echelon-jade-us (plant) | Each Output Map tooltip shows an opaque card surface (computed `opacity` is `1`, the background is the card colour). An Input Map tooltip is unchanged. |
| B1.8 rename | two-echelon-jade-us | The sidebar entry reads `Plant Capability Matrix` and opens `capability-matrix-tab`. |
| B1.9 bands | every model above | Service Stats rows read `0–X`, `X–Y`, …, `> last` in the active unit, one row per boundary plus overflow. They sum to 100 (delivery to 100.00). Toggling km/mi relabels them. Compare with shared bands shows the same exclusive rows plus overflow. |

- [ ] **Step 4: Full e2e gate** (the env var is mandatory, CLAUDE.md)

Before running, confirm that no other vitest or Playwright run is active on this machine: `cnt=$(ps aux | grep "[v]itest" | grep -v "zsh -c" | wc -l | tr -d ' '); [ "$cnt" = "0" ]`, run alone.

```bash
E2E_BASE_URL=http://localhost:5180 pnpm e2e:gate
```

Expected: 0 failures. For each failure: (1) look the test **name** up in `docs/superpowers/flake-registry.md`; (2) re-run that file twice in isolation with the same `E2E_BASE_URL`; (3) a failure that reproduces is a regression. If the spec asserts the pre-B1 contract and was missed by a task's sweep, rewrite it here and record which task missed it. If it is a product defect, report it. Record every new flake sighting in the registry.

- [ ] **Step 5: Solver scripts** (spec "After B1.9")

```bash
cd artifacts/api-server/src/solver/tests && python3 e2e_accuracy.py
```

```bash
cd artifacts/api-server/src/solver/tests && python3 e2e_journey.py http://localhost:3001 delivery
```

```bash
cd artifacts/api-server/src/solver/tests && python3 e2e_journey.py http://localhost:3001 transport
```

Expected: each exits 0 with no `FAIL` line. `solve.py` was untouched, so any failure here is environmental or pre-existing. Record it verbatim and do not "fix" the scripts. `e2e_accuracy.py` is sacred.

- [ ] **Step 6: Unit gate on the bundle tip**

Run the vitest-count check, then the global gate, each separately. Every command must exit 0.

- [ ] **Step 7: Changelog + commit**

Append `### SCU-1.10 — QA: real-browser pass + full e2e gate`. Record: the per-item verdict table; the `e2e:gate` pass/fail/flaky counts measured this run; the solver-script results; every spec repaired here and which task's sweep missed it; and the flake-registry entries added.

```bash
[ "$(git rev-parse --abbrev-ref HEAD)" != "main" ] || exit 1
```

```bash
git commit docs/CHANGELOG-implementation.md docs/superpowers/flake-registry.md -m "[SCU-1.10] record Bundle 1 real-browser QA and full e2e gate" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Add each repaired `artifacts/studio/e2e/<spec>.spec.ts` to that pathspec. Drop `flake-registry.md` from it if the run added nothing there.

---

## Task SCU-1.11: Close-out (lead)

**Owner role:** lead (controller). This task writes no product code. **Depends on:** SCU-1.10 green.

**Files:**
- Modify: `docs/CHANGELOG-implementation.md` (bundle summary subsection)
- `docs/superpowers/metrics/*.csv` (written by `/harness-retro`)

- [ ] **Step 1: Bundle changelog summary**

Append `### SCU-B1 — bundle summary` under the `## SCU-B1` heading. Include: the commit SHA of every SCU-1.N on `scnd-upgrades` (read with `git log --oneline <base>..scnd-upgrades`); the user-visible behaviour changes (exclusive bands with an always-present overflow row; Solution Summary picker hidden behind the button; compare CSV; sidebar expanded on load and collapses on Run Optimizer; inline Save for delivery/max-coverage; the narrative); the deviations 1-11 with one line each; and what is next (Bundle 2, P1 plan). Commit it on the bundle branch:

```bash
[ "$(git rev-parse --abbrev-ref HEAD)" != "main" ] || exit 1
```

```bash
git commit docs/CHANGELOG-implementation.md -m "[SCU-B1] summarise Bundle 1 in the implementation changelog" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 2: `/harness-retro SCU-B1`**

Invoke the `harness-retro` skill with task id `SCU-B1` (`.claude/skills/harness-retro/SKILL.md`). It records the metrics row, the permission audit and each gate failure by cause, and it fires the second-occurrence gate rule. If it drafts a `docs/superpowers/gates/<cause>.md`, STOP and put that draft to the user for approval. Never invent a metric: an underivable value is the literal `unknown`.

- [ ] **Step 3: `superpowers:finishing-a-development-branch`**

Invoke the skill. Put its output to the user as a recommendation, not as a licence.

- [ ] **Step 4: STOP — ask the user; do not merge**

Branch discipline (root CLAUDE.md) says no merge to `main` until **every task in the plan** is complete. The spec defines this branch as Bundle 1 **and** Bundle 2 (P1–P4), executed in order on `scnd-upgrades`. So the default is: **do not merge after Bundle 1; continue with Bundle 2 P1 on the same branch.** Say this explicitly to the user and let them decide between:
1. continue to Bundle 2 on `scnd-upgrades` (default, per the spec); or
2. treat Bundle 1 as its own plan-complete unit and run the pipeline now: merge to local `main`, then the whole-branch review on the merged state, then push. Each of those steps is a separate approval.

Merge approval is not push approval, and push approval is not deploy approval. This bundle has no schema change, so `docs/ops/schema-push-before-deploy.md` does not apply. Still run `pnpm deploy:preflight -- <deployed-sha>..HEAD` for any later deploy request.

---

## Self-review (writing-plans checklist, run against the spec)

**Spec coverage, every Bundle 1 bullet:**

| Spec bullet | Task |
|---|---|
| B1.1 component `OutputMapNarrative.tsx`, testid `output-map-narrative`, rendered only with a result | 1.9 (Steps 5-6) |
| B1.1 unsolved → nothing; stale → parent gate (D5) | 1.9 (OutputMapTab test; `Workspace.StaleOutputs.test.tsx` run) |
| B1.1 pure `buildResultNarrative` + per-family adapters (5 families) | 1.9 (Steps 1-3, deviations 2-3) |
| B1.1 missing field → omitted; objective + solve time from overlay sources | 1.9 (tests "drops …", "omits …") |
| B1.1 second paragraph "How to read this map" per model | 1.9 (`HOW_TO_READ`, test) |
| B1.1 tests: one per family + RTL unsolved hidden | 1.9 |
| B1.2 split `fixedGeography` meanings; delivery Save allowed | 1.5 |
| B1.2 max-coverage inline Save | 1.5 (`showInlineSave` deleted, deviation 8) |
| B1.2 toolbar Save suppressed for both; inline Save right of Layers row, centred; `button-save` kept | 1.5 |
| B1.2 e2e `max-coverage.spec.ts:356-367` + delivery Save scoped to `pmedian-map-toolbar` | 1.5 Step 6 |
| B1.3 titles removed | 1.3 |
| B1.3 green `button-toggle-compare`, picker hidden by default, auto-open at 2+ | 1.3 (deviation 9) |
| B1.3 Download CSV right; single = server export; compare = `buildCompareCsv` | 1.3 |
| B1.3 CSV columns/rows/raw values/empty cells/units in label/filename/row model | 1.3 (tests) |
| B1.3 test: mixed optional rows + differing band sets | 1.3 (`compareCsv.test.ts` + CostSummaryTab "compare CSV: …") |
| B1.4 six titles removed; Download right; JADE Flows sub-titles kept | 1.4 |
| B1.5 controlled `SidebarTree`; localStorage removed; Workspace state init false; Run Optimizer collapses; hamburger toggles | 1.6 |
| B1.5 tests rewritten (`SidebarTree.test.tsx:195-217`, `sidebar-rail.spec.ts:65-139`) | 1.6 |
| B1.6 launcher right-aligned above `DeveloperCredit`; panel upward, anchored right, viewport-bounded; `feedback.spec.ts` layout assertion | 1.7 |
| B1.7 `.leaflet-tooltip.nos-map-tooltip` rule; four NetworkMap sites; lane opacity 0.85 → 1; not on Input Map/EntityMarkers; RTL test | 1.8 |
| B1.8 rename; ids unchanged; e2e text updated | 1.4 (deviation 7: no e2e text exists) |
| B1.9 semantics via `assignBandOrOverflow` | 1.1 (single-source pin) |
| B1.9 live helper: rows + overflow always; zero-flow; residual rule; decimals | 1.1 |
| B1.9 live tests: zero-distance, boundary-equal, overflow at 0, residual = 100, all-zero flow; `bandsSingleSource` pin | 1.1 |
| B1.9 compare helper: absent → null; drop `-1`; sort; difference; clamp; overflow; residual; max-coverage two-row | 1.1 (deviation 1: shape param) |
| B1.9 fixtures: p-median int, delivery 2-dp + `-1`, JADE + `-1`, max-coverage two-row, absent | 1.1 |
| B1.9 display labels in Service Stats + Compare, unit-aware | 1.2 |
| B1.9 untouched: `solve.py`, server exports, legacy `computeBandCoverage` (D6); run `e2e_accuracy.py` | Global Constraints; 1.1 Step 8 (`bands.test.ts`); 1.2 Step 7; 1.10 Step 5 |
| Verification: gate every task; `e2e_accuracy.py` + `e2e_journey.py` after B1.9; full `e2e:gate`, real-browser QA before merge | every task's gate; 1.2 Step 7; 1.10 |
| Risks: behaviour changes recorded in changelog | 1.2, 1.3, 1.6 changelog steps; 1.11 summary |

Gaps found and fixed while writing:
- The spec's `cumulativeToExclusive` would mis-read JADE. Fixed by the `shape` parameter (deviation 1), found by running `solve_jade`.
- The spec's narrative table says two-echelon reads `metrics.openFacilityIds`. Gold-au does not emit it, so the adapter falls back to `details.openWarehouseIds` (deviation 2).
- "Overflow row always" breaks four e2e count-0 assertions and one RTL test. All are rewritten in 1.2.
- The hidden picker breaks 40 RTL lookups and 5 e2e entries. They are handled by `compareToggle` and the inserted clicks in 1.3.
- The expanded-on-load default breaks the flyout-hover specs. They are rewritten in 1.6.

**Placeholder scan:** no "TBD", "TODO", "implement later", "similar to Task N" or "add tests". The only angle-bracket tokens are measured-at-run-time fields (`<N passed>`, `<studio-port>`, `<wave-C tip>`). Each one has a stated derivation, with `unknown` if it cannot be derived.

**Type consistency:** checked across tasks.
- `computeExclusiveBandCoverage(edges, bands, decimals?)`, `frozenBandCoverageToExclusive(bandCoverage, decimals, shape)`, `FrozenBandShape`, `bandDecimals(modelId)`, `frozenBandShape(modelId)` and `exclusiveBandLabels(boundaries, format, unit)` are defined in 1.1 and used with those exact names and arity in 1.2, 1.3 and 1.9.
- `CompareCsvRow { csvLabel; cells: { raw }[] }` (1.3, `lib/compareCsv.ts`) is satisfied structurally by `CompareRow` (1.3, `CostSummaryTab.tsx`).
- `downloadTextFile(filename, text, mimeType)` is used in 1.3 with `"text/csv"`, and the tests assert the same three arguments.
- `buildResultNarrative(modelId, result, ctx)` and `NarrativeContext { bands, distance, solveTimeSec?, displayIdById? }` are used identically in the 1.9 tests and in `OutputMapTab`.
- `SidebarTree` `collapsed` / `onCollapsedChange` are used identically in 1.6's component, tests and Workspace mount.
