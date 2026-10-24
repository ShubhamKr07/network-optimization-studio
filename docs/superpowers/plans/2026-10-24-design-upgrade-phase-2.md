# Design Upgrade Phase 2 Implementation Plan (shared components and copy)

> **Execution: agent-team dispatch per `AGENTS.md`**, the same as Phase 1. The lead (Opus session) does the following:
> - Pre-creates one locked worktree per task (`git worktree add --lock /Users/shubhamkr/nos-du-2.N -b du-2.N-work <base-sha>`).
> - Dispatches **without** `isolation`. The agent's first Bash command is `cd <path>` plus a branch check.
> - Reviews each engineering task on Opus plus `ponytail-review`, then cherry-picks it onto `design-upgrade-p2`. The next task's worktree is cut from the new `design-upgrade-p2` tip, so tasks stay sequential.
>
> Roles:
> - **DU-2.1 to DU-2.8:** `frontend-engineer` (sonnet). Each brief explicitly hands over that task's unit-test and e2e files (tests are qa-sdet's by default).
> - **DU-2.9:** `qa-sdet` (sonnet), reviewed by a separate `fable` reviewer agent.
>
> Steps use checkbox (`- [ ]`) syntax.

**Goal:** Implement spec §5.2 (`docs/superpowers/specs/2026-10-24-design-upgrade-design.md`, v2), display only:
- one formatter set;
- one band-range label authority;
- units in headers;
- the copy pass;
- header and actions;
- `DataTable` affordances;
- entity naming;
- parameter guidance.

**Architecture:**
- Two new shared authorities: `formatMoney` in studio `lib/formatObjective.ts`, and `bandRangeLabel` + `formatDistanceNumber` in `@workspace/units`.
- One new presentational component, `BandLabel`.
- The rest is call-site switches and component-local changes.
- No API, schema, Zod, OpenAPI, codegen, manifest or solver change.
- Server exports keep their current `distance_band` text (`Band N` / `Overflow`) until DU-4.2.

**Tech stack:**
- React 18 + Vite + Tailwind v4
- vitest + RTL
- Playwright
- `@workspace/units` (`lib/units`, vitest, node env)

## Global Constraints

Everything in the master plan's Global Constraints (`2026-10-24-design-upgrade.md:22-56`) binds every task here. The Phase 2 specifics are:

**Interfaces and display**
- The fixed interfaces (master §A) keep exactly these names:
  - `formatDistanceDisplay(value: number): string` (same signature, broadened scope);
  - `formatMoney(value: number, opts?: { compact?: boolean }): string` in `lib/formatObjective.ts`;
  - `bandRangeLabel(index: number, bands: number[], unit: CanonicalUnit): string` in `@workspace/units`;
  - `components/BandLabel.tsx` → `<BandLabel index bands unit />`;
  - `Chapter.demandUnit: "tons" | "units"` (required);
  - `DataTable` prop `loading?: boolean`.
- Display only. These are untouched: `roundForFile`, `lib/units/src/convert.ts` semantics, every server export, `lib/jadeFlowsExport.ts` column values (the client mirror of the server JADE flows export).
- Non-finite numbers render `—` (spec §7).
- Every formatter pins `en-US`, as `formatDistanceDisplay` already does.

**Scope and process**
- **Orphan modules stay untouched.** `components/ObjectiveBar.tsx`, `components/ConstraintChips.tsx`, `components/BrazilMap.tsx` and `components/MapBulkEditToolbar.tsx` have zero non-test importers (rg 2026-10-24). They're neither swept nor counted (see Q8).
- Each task runs a **sibling e2e sweep**: rg `artifacts/studio/e2e/` for every string or testid the task changes, and rewrite those specs in the same commit (root `CLAUDE.md` gotcha). `pnpm e2e:gate` runs in DU-2.9 against local servers.
- Each task appends its `### DU-2.N — …` changelog entry in the same commit.
- Per-task gate: `pnpm run typecheck`, `pnpm --filter studio test`, plus `pnpm --filter @workspace/units test` when `lib/units` changes. Zero concurrent vitest first. The full `pnpm gate` runs at phase close-out. `e2e_accuracy.py` and `e2e_journey.py` aren't required in Phase 2 (master Q3: Phases 4 and 6 plus the final review).
- Commit pattern (each task):

  ```bash
  [ "$(git rev-parse --abbrev-ref HEAD)" = "du-2.N-work" ] || exit 1
  P="<static file list>"; git add -- ${=P}; git diff --cached --name-only   # must equal P
  git commit --only ${=P} -m "[DU-2.N] <summary>" -m "<body>" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
  ```

## Applied defaults (recommended; confirm via Lavish before execution)

Each one is applied in the task bodies below. Changing one changes only the named task.

| ID | Default applied | Task |
|---|---|---|
| Q1 | `formatMoney` full: `$169,061,531` (0 dp, grouped). Compact: ≥ 1e9 → `$1.23B`; ≥ 1e6 → `$169.06M`; ≥ 1e3 → `$842K` (0 dp); else `$842.50` | 2.1 |
| Q2 | Table distances use `formatDistanceDisplay` (≤ 2 dp). The narrative keeps whole numbers (NAR-1 decision 5) but groups through `formatDistanceDisplay(Math.round(x))` | 2.1 |
| Q3 | "Quality: Unverified" keeps the word and gains a tooltip: "Solved before solution quality was recorded. Re-run to verify." The Landing badge gets the same tooltip | 2.4 |
| Q4 | One filled primary per view = the header "Run Optimizer". In-tab actions become `variant="outline"`: Compare Scenario, Optimization Parameters "Solve", the stale-banner Run Optimizer, the readiness-panel "Import network". Dialogs keep their own filled confirm | 2.5 |
| Q5 | Lane-colour segmented control: "Distance band" / "Leg" on two-echelon/JADE/super, "Distance band" / "None" elsewhere | 2.5 |
| Q6 | The Distances "Leg" column becomes `DataTable` `sections`, one group header per leg. The red "Unrecognized pair" stays red (it's an error) | 2.6 |
| Q7 | P presets = current P−2 … P+2, clamped to 1 … `pMax` (the existing upper bound). `pMax` itself is unchanged | 2.8 |
| Q8 | The 4 orphan modules are left untouched (deletion would be a separate task) | all |
| Q9 | `transport-coal.demandUnit = "tons"`, since its stations already say "tons". JADE = "tons" (C1). Other 6 = "units" | 2.3 |

All paths below are relative to `artifacts/studio/src/` unless they start with `artifacts/`, `docs/` or `lib/`.

---

## Branch setup (once, before DU-2.1)

```bash
cd /Users/shubhamkr/network-optimization-studio
git rev-parse --abbrev-ref HEAD   # design-upgrade-p2 (cut from main 080fe5cd, which holds this plan once committed)
git worktree add --lock /Users/shubhamkr/nos-du-2.1 -b du-2.1-work design-upgrade-p2
(cd /Users/shubhamkr/nos-du-2.1 && pnpm install --frozen-lockfile --prefer-offline)
```

---

### Task DU-2.1: One formatter set

**Files:**
- Create: `lib/units/src/format.ts`, `lib/units/src/__tests__/format.test.ts`
- Modify: `lib/units/src/index.ts`, `lib/formatDistanceDisplay.ts`, `lib/formatObjective.ts`, `lib/formatLocation.ts`
- Modify (call sites): `components/NetworkMap.tsx:265,438-439`, `components/workspace/tabs/OutputMapTab.tsx:202-205,416`, `components/workspace/tabs/AssignmentsTab.tsx:190`, `components/workspace/tabs/FlowsTab.tsx:131`, `components/workspace/tabs/JadeAssignmentsTab.tsx:239`, `components/workspace/tabs/JadeFlowsTab.tsx:230-231`, `components/workspace/tabs/CostSummaryTab.tsx:32-40,63,564,567,757,763`, `lib/resultNarrative.ts:45,57-59,114,206`, `pages/Landing.tsx:45-51`, `components/workspace/map/dialogs/{EditWarehouseDialog,EditCustomerDialog,MoveConfirmDialog,CreateEntityDialog}.tsx` (lat/lng display lines)
- Test: `__tests__/formatObjective.test.ts`, `__tests__/formatDistanceDisplay.test.ts`, `__tests__/resultNarrative.test.ts`, plus the literal-asserting files below
- e2e (sibling sweep): `artifacts/studio/e2e/two-echelon.spec.ts:130`, `jade-two-echelon.spec.ts:130`, and any further rg hits

**Interfaces:**
- Produces, `@workspace/units`: `formatDistanceNumber(value: number): string`, with en-US grouping, ≤ 2 dp and `—` for non-finite values. It's the single number authority shared with the server (DU-4.2).
- Produces, studio: `formatDistanceDisplay(value)` is now a thin re-export of `formatDistanceNumber`; the signature is unchanged.
- Produces: `formatMoney(value: number, opts?: { compact?: boolean }): string`.
- Produces: `formatCoord(value: number): string` (4 dp, `—` for non-finite values) in `lib/formatLocation.ts`.
- Consumed by DU-2.2 (`bandRangeLabel` uses `formatDistanceNumber`).

- [ ] **Step 1: Write the failing unit tests**

`lib/units/src/__tests__/format.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { formatDistanceNumber } from "../index.js";

describe("formatDistanceNumber", () => {
  it("groups en-US with at most 2 dp", () => {
    expect(formatDistanceNumber(12004.8)).toBe("12,004.8");
    expect(formatDistanceNumber(11998.2461)).toBe("11,998.25");
    expect(formatDistanceNumber(892)).toBe("892");
  });
  it("renders — for non-finite", () => {
    expect(formatDistanceNumber(Number.NaN)).toBe("—");
    expect(formatDistanceNumber(Number.POSITIVE_INFINITY)).toBe("—");
  });
});
```

Append to `__tests__/formatObjective.test.ts`:
```ts
import { formatMoney } from "@/lib/formatObjective";

describe("formatMoney (DU-2.1)", () => {
  it("full: grouped whole dollars", () => {
    expect(formatMoney(169061531.4)).toBe("$169,061,531");
    expect(formatMoney(-1234.6)).toBe("-$1,235");
  });
  it("compact: B / M at 2 dp, K at 0 dp, small at 2 dp", () => {
    expect(formatMoney(1_234_000_000, { compact: true })).toBe("$1.23B");
    expect(formatMoney(169_061_531, { compact: true })).toBe("$169.06M");
    expect(formatMoney(842_400, { compact: true })).toBe("$842K");
    expect(formatMoney(842.5, { compact: true })).toBe("$842.50");
    expect(formatMoney(-6_300_000, { compact: true })).toBe("-$6.30M");
  });
  it("non-finite renders —", () => {
    expect(formatMoney(Number.NaN)).toBe("—");
    expect(formatMoney(Number.NEGATIVE_INFINITY, { compact: true })).toBe("—");
  });
  it("pins en-US even when the default locale is German", () => {
    // Same technique as formatDistanceDisplay.test.ts:42-50: an undefined locale resolves to de-DE,
    // so an unpinned toLocaleString() would print 169.061.531.
    const orig = Number.prototype.toLocaleString;
    Number.prototype.toLocaleString = function (this: number, loc?: string | string[], o?: Intl.NumberFormatOptions) {
      return orig.call(this, loc === undefined ? "de-DE" : loc, o);
    };
    try {
      expect(formatMoney(169061531)).toBe("$169,061,531");
      expect(formatMoney(842_400, { compact: true })).toBe("$842K");
    } finally {
      Number.prototype.toLocaleString = orig;
    }
  });
});
```

Add a `formatCoord` case to `lib/formatLocation.test.ts`: `formatCoord(39.099724)` gives `"39.0997"`, and `formatCoord(NaN)` gives `"—"`.

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `pnpm --filter @workspace/units test` and `pnpm --filter studio test -- formatObjective formatLocation`
Expected: FAIL, with `formatDistanceNumber` / `formatMoney` / `formatCoord` not exported.

- [ ] **Step 3: Implement**

`lib/units/src/format.ts`:
```ts
/** DU-2.1 — the ONE number authority for a displayed distance (studio UI now; server exports from DU-4.2).
 *  en-US pinned (labels feed downloads), at most 2 dp, no unit. `roundForFile` (4 dp) stays the serialization contract. */
export function formatDistanceNumber(value: number): string {
  if (!Number.isFinite(value)) return "—";
  return value.toLocaleString("en-US", { maximumFractionDigits: 2 });
}
```
In `lib/units/src/index.ts`, add `export * from "./format.js";`.

In `lib/formatDistanceDisplay.ts`, keep `stripGrouping` and replace the body of `formatDistanceDisplay` with a re-export. Rewrite the scope comment (lines 1-14): it is now the display formatter for **every displayed distance**, it's still not applied to editable inputs (`useDistanceDraft` `presentation` stays opt-in), and it's a re-export of the units authority.
```ts
export { formatDistanceNumber as formatDistanceDisplay } from "@workspace/units";
```

In `lib/formatObjective.ts`, add the following. The `formatObjective` monetary branch then returns `formatMoney(converted)` instead of its 2-dp `$` template.
```ts
const usd0 = (n: number) => Math.round(Math.abs(n)).toLocaleString("en-US");
/** DU-2.1 — full `$169,061,531` for tables; compact `$169.06M` for chips and the narrative. */
export function formatMoney(value: number, opts?: { compact?: boolean }): string {
  if (!Number.isFinite(value)) return "—";
  const sign = value < 0 ? "-" : "";
  const a = Math.abs(value);
  if (!opts?.compact) return `${sign}$${usd0(a)}`;
  if (a >= 1e9) return `${sign}$${(a / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${sign}$${(a / 1e6).toFixed(2)}M`;
  if (a >= 1e3) return `${sign}$${usd0(a / 1e3)}K`;
  return `${sign}$${a.toFixed(2)}`;
}
```

In `lib/formatLocation.ts`:
```ts
/** DU-2.1 — latitude/longitude display, 4 dp. */
export function formatCoord(value: number): string {
  return Number.isFinite(value) ? value.toFixed(4) : "—";
}
```

- [ ] **Step 4: Switch the call-site inventory**

Verify each site with `rg -n` first; line numbers are from 080fe5cd. Let `fdd = formatDistanceDisplay`.

| Site | Before | After |
|---|---|---|
| `NetworkMap.tsx:265` | `${info.distanceMi.toLocaleString()} ${distanceUnit}` | `${fdd(info.distanceMi)} ${distanceUnit}` |
| `NetworkMap.tsx:438-439` | `…toDisplay(raw, distanceUnit).toLocaleString()…` | `fdd(displayUnit.toDisplay(raw, distanceUnit))` + unit |
| `OutputMapTab.tsx:202-205` | `.toFixed(1)` | `fdd(unit.toDisplay(…))` + unit |
| `OutputMapTab.tsx:416` | `result.objective.toLocaleString()` | the shared objective chain used at `CostSummaryTab.tsx:522-523`, so the objective carries a unit or currency |
| `AssignmentsTab.tsx:190`, `FlowsTab.tsx:131` | `.toFixed(1)` | `fdd(unit.toDisplay(…))` (headers already carry the unit; DU-2.3 confirms) |
| `JadeAssignmentsTab.tsx:239`, `JadeFlowsTab.tsx:230-231` | `.toFixed(1)` + unit | `fdd(…)` + unit |
| `CostSummaryTab.tsx:32-40` | `formatDistance` / `formatDistanceValueOnly` use `.toFixed(1)` | both use `fdd(…)` |
| `CostSummaryTab.tsx:63` | `money = $…2dp` | `money = (v) => formatMoney(v)` |
| `CostSummaryTab.tsx:564,567,757,763` | `inboundCost.toLocaleString()` etc. (no `$`) | `formatMoney(…)` |
| `resultNarrative.ts:45` | `grouped = n => n.toLocaleString("en-US")` | unchanged (counts and per-ton dollars stay whole numbers) |
| `resultNarrative.ts:107` | `grouped(Math.round(d.toDisplay(c)))` | `fdd(Math.round(d.toDisplay(c)))` (same text, one authority) |
| `resultNarrative.ts:57-59` | `$…toFixed(1)M` / `$…K` | `formatMoney(v, { compact: true })` |
| `resultNarrative.ts:114` | `$…en-US 2dp` (super cost) | `formatMoney(total)` |
| `Landing.tsx:45-51` | `.toFixed(1)` both branches | `fdd(…)` + unit |
| Edit/Move/Create dialog lat/lng display `<p>` | raw `{entity.lat}` | `{formatCoord(entity.lat)}` (display text only, never the editable inputs) |
| Tables and `MapDetailsCard` lat/lng | `.toFixed(4)` | `formatCoord(…)` (same text, one authority) |

Not switched, on purpose (record each in the changelog entry):
- `BandChipEditor.tsx:127,274`: editable chips; the `formatDistanceDisplay` doc keeps inputs out of scope.
- `OptimizationParametersTab.tsx:530` (`UnitContext.format`).
- `JadeDistancesTab.tsx:546` cost `.toFixed(2)`: a $/ton rate, not money.
- `lib/jadeFlowsExport.ts:47`: export values.
- The orphan modules.

- [ ] **Step 5: Rewrite the literal-asserting tests**

- rg the studio tests for the old forms and update each to the new output:
  - `resultNarrative.test.ts:88,178,252`: `"$182.0M"` becomes `"$182.00M"`, and `"$6.3M"` becomes `"$6.30M"`.
  - `CostSummaryTab.test.tsx` money/distance literals.
  - `JadeAssignmentsTab.test.tsx`, `JadeFlowsTab.test.tsx`, `OutputMapTab.test.tsx`, `NetworkMap.test.tsx`, `Landing.test.tsx`, `formatObjective.test.ts:160` (`"$100.00"` becomes `"$100"`).
- Re-derive each expected value from the new formatter; never weaken an assertion to `toContain` to make it pass.
- e2e:
  - `two-echelon.spec.ts:130` `/^\d+\.\d$/` becomes `/^[\d,]+(\.\d{1,2})?$/`.
  - `jade-two-echelon.spec.ts:130` `/^\$[\d,]+\.\d{2}$/` becomes `/^\$[\d,]+$/`.
- rg `artifacts/studio/e2e` for `toFixed(1)`-shaped literals (`\.\d mi`, `422\.6`) and confirm each still holds. `delivery-teaching.spec.ts:212` uses `toContainText("422.6 mi")`; re-measure it against the fixture value and update it if the 2-dp text differs.

- [ ] **Step 6: Run the tests and confirm they pass**

Run: `pnpm --filter @workspace/units test`, `pnpm run typecheck`, `pnpm --filter studio test`
Expected: all green. Then `pnpm --filter studio run typecheck:e2e`.

- [ ] **Step 7: Review pass**

Run `ponytail:ponytail-review` on the diff. The lead re-runs `rg -n "toFixed\(1\)|toLocaleString\(\)" components/workspace/tabs components/NetworkMap.tsx lib/resultNarrative.ts pages/Landing.tsx` and accounts for every remaining hit as a non-distance/non-money value or an excluded site.

- [ ] **Step 8: Commit**

`[DU-2.1] one formatter set: formatDistanceNumber authority, formatMoney, formatCoord, call sites switched`, with the changelog entry listing the excluded sites and why.

---

### Task DU-2.2: Range-label authority + `BandLabel`

**Files:**
- Modify: `lib/units/src/bands.ts`, `lib/units/src/__tests__/bands.test.ts`
- Create: `components/BandLabel.tsx`, `__tests__/BandLabel.test.tsx`, `__tests__/bandLabelSource.test.ts`
- Modify: `lib/bands.ts` (delete studio `bandRangeLabel` :123-133 and `exclusiveBandLabels` :164-171), `components/workspace/tabs/JadeAssignmentsTab.tsx:196,208,242-251`, `components/workspace/tabs/JadeFlowsTab.tsx:256,271,313-324`, `lib/jadeFlowsExport.ts`, `components/workspace/map/MapLegend.tsx:136-143,178-182,295-345`, `components/workspace/tabs/ServiceStatsTab.tsx:347-356`, `components/workspace/tabs/CostSummaryTab.tsx:484-487`, `components/NetworkMap.tsx:246-250,279-283,594-595,817`, `pages/Workspace.tsx:4415` (comment)
- Test (rewrite): `__tests__/bands.test.ts:235-332`, `__tests__/exclusiveBands.test.ts` (delete; its cases move to `lib/units` tests), `__tests__/JadeFlowsTab.test.tsx:171-223,367-442`, `__tests__/JadeAssignmentsTab.test.tsx:157-166,283-291`, `__tests__/MapLegend.test.tsx:171,255-280`, `__tests__/NetworkMap.test.tsx:1269,1428-1436,1573-1645`, `__tests__/ServiceStatsTab.test.tsx` (band literals), `__tests__/CostSummaryTab.test.tsx:917,1280-1282,1568`
- Unchanged on purpose: `__tests__/bandsSingleSource.test.ts`, `__tests__/jadeFlowsExport.test.ts` (export values stay `Band N` / `Overflow` until DU-4.2), all api-server tests
- e2e (rewrite): `workspace-fixups-2.spec.ts:583-599`, `workspace-fixups.spec.ts:160-168,344,423`, `jade-ch9-workspace-bundle.spec.ts:336,378,389`

**Interfaces:**
- Consumes: `formatDistanceNumber` (DU-2.1); `assignBandOrOverflow`, `OVERFLOW_BAND`, `CanonicalUnit` (existing); `getBandColor`, `getBandDash` (DU-1.2).
- Produces, `@workspace/units`: `bandRangeLabel(index: number, bands: number[], unit: CanonicalUnit): string`. `bands` are boundaries **in the display unit** (callers convert with the unit API) and `unit` is the display unit. DU-4.2's server export calls it with the requested unit.
- Produces, studio: `<BandLabel index={number} bands={number[]} unit={CanonicalUnit} />`. It renders the colour swatch, the dash swatch and the text.

- [ ] **Step 1: Write the failing authority tests (`lib/units/src/__tests__/bands.test.ts`)**

```ts
import { bandRangeLabel, assignBandOrOverflow, OVERFLOW_BAND } from "../index.js";

describe("bandRangeLabel (DU-2.2)", () => {
  const B = [200, 400, 800, 1600];
  it("first / middle / overflow text, upper-inclusive", () => {
    expect(bandRangeLabel(0, B, "mi")).toBe("≤ 200 mi");
    expect(bandRangeLabel(1, B, "mi")).toBe("200–400 mi");
    expect(bandRangeLabel(3, B, "mi")).toBe("800–1,600 mi");
    expect(bandRangeLabel(OVERFLOW_BAND, B, "mi")).toBe("> 1,600 mi");
    expect(bandRangeLabel(assignBandOrOverflow(200, B), B, "mi")).toBe("≤ 200 mi");   // boundary -> lower band
    expect(bandRangeLabel(assignBandOrOverflow(1600.0001, B), B, "mi")).toBe("> 1,600 mi");
  });
  it("sorts its input and uses the shared number format", () => {
    expect(bandRangeLabel(1, [400, 200], "km")).toBe("200–400 km");
    expect(bandRangeLabel(0, [321.8688], "km")).toBe("≤ 321.87 km");
  });
  it("no bands -> 'All distances'", () => {
    expect(bandRangeLabel(0, [], "mi")).toBe("All distances");
  });
  it("never emits 'Band N'", () => {
    for (const i of [0, 1, 2, 3, OVERFLOW_BAND]) expect(bandRangeLabel(i, B, "mi")).not.toMatch(/Band/);
  });
});
```
Move every case from studio `__tests__/exclusiveBands.test.ts` here, re-expressed through `bandRangeLabel` (the first row changes from `0–200` to `≤ 200`).

- [ ] **Step 2: Run the test and confirm it fails**

Run: `pnpm --filter @workspace/units test`
Expected: FAIL, `bandRangeLabel` not exported.

- [ ] **Step 3: Implement the authority (`lib/units/src/bands.ts`)**

```ts
import { formatDistanceNumber } from "./format.js";
import type { CanonicalUnit } from "./convert.js";

/** DU-2.2 — the ONE band range label (UI now; exports from DU-4.2). `bands` are boundaries in the DISPLAY unit.
 *  Upper-inclusive (a boundary value belongs to the lower band, as assignBandOrOverflow): first `≤ a u`,
 *  middle `a–b u`, overflow `> z u`. Never "Band N". */
export function bandRangeLabel(index: number, bands: number[], unit: CanonicalUnit): string {
  const s = [...bands].sort((a, b) => a - b);
  if (s.length === 0) return "All distances";
  const f = formatDistanceNumber;
  if (index === OVERFLOW_BAND || index >= s.length) return `> ${f(s[s.length - 1])} ${unit}`;
  if (index <= 0) return `≤ ${f(s[0])} ${unit}`;
  return `${f(s[index - 1])}–${f(s[index])} ${unit}`;
}
```
`bandLabelOrOverflow` stays unchanged, because it's the server export's label until DU-4.2.

- [ ] **Step 4: Write the failing `BandLabel` test + the source guard**

`__tests__/BandLabel.test.tsx`: render `<BandLabel index={1} bands={[200,400]} unit="mi" />`. Assert:
- the text is `"200–400 mi"`;
- an element `[data-band-swatch]` has `background-color: var(--band-1)`;
- the `svg line` has `stroke-dasharray="10 4"`;
- for `index={OVERFLOW_BAND}`: the text is `"> 400 mi"`, the swatch uses `var(--band-overflow)`, and the line has no `stroke-dasharray`.

`__tests__/bandLabelSource.test.ts`, in the pattern of `rawPaletteClasses.test.ts` (tree walk of `src/`, skip `__tests__` and `*.test.*`, skip comment lines):
```ts
const BAND_CONSTRUCT = /`Band \$\{|["']Band ["']\s*\+/;
const LEGACY_LABEL_CALL = /\b(bandLabel|bandLabelOrOverflow)\s*\(/;
// Allow-list: each entry names its reason; removed in DU-4.2 when exports switch to bandRangeLabel.
const ALLOWED_LEGACY_LABEL_CALLS = ["lib/jadeFlowsExport.ts"]; // mirrors the server JADE flows export column
it("non-vacuity", () => {
  expect(BAND_CONSTRUCT.test("`Band ${i + 1}`")).toBe(true);
  expect(BAND_CONSTRUCT.test('"Band " + n')).toBe(true);
  expect(LEGACY_LABEL_CALL.test("bandLabel(d, bands)")).toBe(true);
  expect(walk().length).toBeGreaterThan(100);
});
it("no Band N label construction anywhere in studio src", () => { /* hits === [] */ });
it("legacy Band-N label calls only in the allow-list", () => { /* hits outside ALLOWED === [] */ });
it("every allow-list entry still contains a legacy call (stale-entry check)", () => { /* ... */ });
```
`lib/bands.ts:51`'s re-export line `export { bandLabelOrOverflow as bandLabel }` doesn't match `LEGACY_LABEL_CALL` (no call parenthesis), so the re-export stays. `bandsSingleSource.test.ts` keeps pinning it.

- [ ] **Step 5: Implement `BandLabel` and switch every UI surface**

`components/BandLabel.tsx`:
```tsx
import { bandRangeLabel, OVERFLOW_BAND, type CanonicalUnit } from "@workspace/units";
import { getBandColor, getBandDash } from "@/lib/bandPalette";

/** DU-2.2 — band text + colour + pattern swatch. `bands` in the display unit. */
export function BandLabel({ index, bands, unit }: { index: number; bands: number[]; unit: CanonicalUnit }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <span data-band-swatch className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: getBandColor(index) }} aria-hidden="true" />
      <svg width="14" height="6" aria-hidden="true" className="shrink-0">
        <line x1="0" y1="3" x2="14" y2="3" stroke={getBandColor(index)} strokeWidth="2.5" strokeDasharray={index === OVERFLOW_BAND ? undefined : getBandDash(index)} />
      </svg>
      <span>{bandRangeLabel(index, bands, unit)}</span>
    </span>
  );
}
```

Surfaces:

| Site | Change |
|---|---|
| `JadeAssignmentsTab.tsx:196,242-251` | Row field `band` becomes `bandIndex: assignBandOrOverflow(a.distanceMi, effectiveBands)` (index in canonical space). Column `value` becomes `bandRangeLabel(r.bandIndex, displayBands, resolvedUnit)`; `cell` becomes `<BandLabel index={r.bandIndex} bands={displayBands} unit={resolvedUnit} />`. Keep `filterResetKey`. When not `canonicalResolved`, both show `"—"` as today |
| `JadeFlowsTab.tsx:256,271,313-324` | Same shape in `legColumns`. The JADE flows client export (`jadeFlowsExport.ts`) now derives its `band` column itself with `bandLabel(row.distance, bands)` (allow-listed), so `JadeFlowsTab` no longer calls `bandLabel` |
| `MapLegend.tsx:304-345` | Keep the existing swatch/dash markup and testids (`legend-band-${i}`, `legend-dash-${i}`, `legend-overflow-band`, `legend-overflow-dash`; e2e pins them). Replace the text `≤ {formatBandBoundary(boundary)}` and the `Overflow` JSX text with `bandRangeLabel(i, displayBands, resolvedUnit)` / `bandRangeLabel(OVERFLOW_BAND, …)`, so every row is a range. Delete `formatBandBoundary`, and fix the stale comments at :136-143 and :295-303. Unresolved unit: text `"—"` |
| `ServiceStatsTab.tsx:347-356` | `labels[i]` becomes `<BandLabel index={b.band} bands={displayBands} unit={distanceUnit} />`, where `displayBands = bandCoverage.filter(non-overflow).map(b => toDisplay(b.band, canonicalUnit))` |
| `CostSummaryTab.tsx:484-487` | `bandRowLabels` becomes a map over `[...sorted indices, OVERFLOW_BAND]` with `bandRangeLabel(i, displayBoundaries, unitLabel)`. The compare CSV download gets the same text: it's a studio table download, not the server contract |
| `NetworkMap.tsx:594-595,279-283` | Popup info `bandLabelText` becomes `bandRangeLabel(band, displayBands, unit)`. The popup HTML drops the `Band:` prefix and keeps its swatch span. HTML string popups can't take a React component, so they use the text authority directly |
| `NetworkMap.tsx:817` | Hover tooltip `· ${bandLabel(...)}` becomes `· ${bandRangeLabel(assignBandOrOverflow(d, bands), displayBands, unit)}` |

Then delete studio `bandRangeLabel` and `exclusiveBandLabels` from `lib/bands.ts`. rg must show zero studio imports of them.

- [ ] **Step 6: Rewrite the tests listed under Files**

- Expected strings change from `Band N…` / `Overflow` / `≤ X` / `0–X` to the authority's text, re-derived per case. Examples:
  - `JadeFlowsTab.test.tsx:367-373` becomes `["≤ 250 mi","250–500 mi","500–750 mi","750–1,000 mi","> 1,000 mi"]`.
  - `JadeAssignmentsTab.test.tsx:283-291` option testids become `option-filter-band-≤ 250 mi` … `option-filter-band-> 1,000 mi`.
  - `MapLegend.test.tsx:255-259` gets `"≤ 200 mi"`, `"200–400 mi"`, `"400–800 mi"`, `"800–1,600 mi"`, plus an overflow row `"> 1,600 mi"`. `"≤ —"` becomes `"—"`.
  - `NetworkMap.test.tsx:1573-1645` `toContain("Overflow")` becomes `toContain("> 1,600 mi")` (or that fixture's last boundary).
- e2e:
  - `workspace-fixups-2.spec.ts:583-587` gets the range strings; `:599` `/^(Band \d+|Overflow)$/` becomes `/^(≤ [\d,.]+ \S+|[\d,.]+–[\d,.]+ \S+|> [\d,.]+ \S+)$/`.
  - `workspace-fixups.spec.ts:160-168` deletes the local mirror and imports `bandRangeLabel` from `@workspace/units`; `:344,:423` use the same three-form regex.
  - `jade-ch9-workspace-bundle.spec.ts:336,378,389` `"Overflow"` becomes `/^> [\d,.]+ (mi|km)$/` (cell) and `/> [\d,.]+ (mi|km)/` (tooltip/popup).
- Run the rg inventory and paste it into the changelog entry: `rg -n 'Band \$\{|"Band |Overflow' src artifacts/studio/e2e lib/units/src`. Every remaining hit must be an allow-listed export path, the units `bandLabelOrOverflow`, a test of either, or a comment.

- [ ] **Step 7: Run the tests and confirm they pass**

Run: `pnpm --filter @workspace/units test`, `pnpm run typecheck`, `pnpm --filter studio test`, `pnpm --filter studio run typecheck:e2e`
Expected: green. `bandLabelSource.test.ts` reports 0 hits, with one allow-list entry.

- [ ] **Step 8: Review pass + commit**

`ponytail:ponytail-review`. Commit `[DU-2.2] one band range-label authority in @workspace/units + BandLabel on every UI surface`, with the changelog entry noting that exports are unchanged until DU-4.2.

---

### Task DU-2.3: Units in headers; `Chapter.demandUnit`

**Files:**
- Modify: `lib/chapters.ts:3-37` (type + 8 entries), `components/workspace/tabs/CustomersTab.tsx:308-343`, `components/workspace/tabs/CapabilityMatrixTab.tsx:157-162` + its header, `components/data-table/entityCells.tsx:132-173` (`DemandCell.suffix` becomes optional), `components/data-table/FormattedNumberInput.tsx` (unchanged API; callers stop passing `suffix`), `components/workspace/map/dialogs/CreateEntityDialog.tsx:646-670`, `components/workspace/tabs/StationsTab.tsx:188-196`, `components/workspace/tabs/TransportCostsTab.tsx:245-247,270-272`
- Test: `lib/chapters.test.ts`, `__tests__/CustomersTab.dataTable.test.tsx:74-80,230`, `__tests__/CapabilityMatrixTab.test.tsx:328-354`, `__tests__/CreateEntityDialog.table.test.tsx:140-182`, `__tests__/StationsTab.dataTable.test.tsx:65`, `__tests__/TransportCostsTab.test.tsx:119-123`, `__tests__/scuR5aFixes.test.tsx:97`, `__tests__/Landing.lockedRendering.test.tsx:38-59` (add `demandUnit` to both fixtures, even though they're cast)
- e2e: `workspace-fixups.spec.ts:310-311`, `jade-ch9-workspace-bundle.spec.ts:466-480`

**Interfaces:**
- Produces: `Chapter.demandUnit: "tons" | "units"` (required). The values are `two-echelon-jade-us` and `transport-coal` = `"tons"` (C1, Q9); the other 6 = `"units"`.
- Produces: `demandHeader(unit: Chapter["demandUnit"], base = "Demand"): string`, which gives `` `${base} (${unit})` `` in `lib/chapters.ts`.

- [ ] **Step 1: Write the failing test**

In `lib/chapters.test.ts`:
```ts
it("DU-2.3: every chapter declares its demand unit (JADE + coal in tons)", () => {
  const byId = Object.fromEntries(CHAPTERS.map(c => [c.modelId, c.demandUnit]));
  expect(byId["two-echelon-jade-us"]).toBe("tons");
  expect(byId["transport-coal"]).toBe("tons");
  for (const id of ["p-median-us","max-coverage-us","p-median-brazil","delivery-teaching-us","two-echelon-gold-au","super-model"])
    expect(byId[id]).toBe("units");
  expect(demandHeader("tons")).toBe("Demand (tons)");
});
```
In the `CustomersTab` / `CapabilityMatrix` tests, the header reads `Demand (units)` / `Demand (tons)`, no per-cell `Units` text exists (`queryByText("Units")` is null), and the capacity readout is the bare grouped number (`"210,000,000"`).

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `pnpm --filter studio test -- chapters CustomersTab CapabilityMatrixTab`
Expected: FAIL.

- [ ] **Step 3: Implement**

- Add the field. Every entry must declare it; `tsc` enforces this for literals.
- Thread the active chapter's `demandUnit` from `Workspace.tsx` (`activeChapter`) into the consumers as a prop (`demandUnit`), following how `modelId` is threaded. `CustomersTab` headers become `demandHeader(demandUnit)` (scalar) and `` `${p.name} (${demandUnit})` `` (per product).
- Remove `suffix="Units"` from `DemandCell` and `CreateEntityDialog`. The dialog's demand field label becomes `demandHeader(demandUnit)`.
- `StationsTab` already says "tons": keep its header `"Demand override (tons)"` and drop `suffix="tons"`.
- `CapabilityMatrixTab`: the column/section header carries `(tons)` or `(units)` from `demandUnit`; the readout drops ` Units`.
- `TransportCostsTab`: delete the repeated `label-transport-rate-unit-${leg}` / `label-transport-min-unit-${leg}` spans. The header already carries the unit (`label-transport-rate-unit-head`).
- `FormattedNumberInput` keeps `suffix?` for other callers. rg confirms whether any remain; if none, leave the prop (no API churn).

- [ ] **Step 4: Run the tests and confirm they pass; rewrite literals**

- Rewrite the tests listed under Files.
- e2e: `"210,000,000 Units"` becomes `"210,000,000"`, and `"0 Units"` becomes `"0"`.
- rg `artifacts/studio/e2e` for `Units`, `label-transport-rate-unit-`, `label-transport-min-unit-`.

Run: `pnpm run typecheck`, `pnpm --filter studio test`, `pnpm --filter studio run typecheck:e2e`
Expected: green.

- [ ] **Step 5: Review + commit**

`[DU-2.3] units move into headers; Chapter.demandUnit (JADE and coal in tons)`.

---

### Task DU-2.4: Copy pass

**Files:**
- Modify: `components/workspace/tabs/CostSummaryTab.tsx:93,590,853-854`, `lib/resultOutcome.ts:49-54`, `pages/Landing.tsx:214-221`, `components/data-table/DataTable.tsx:299-303` + `types.ts` (`countNoun?: string`), `components/workspace/tabs/CapabilityMatrixTab.tsx:176`, `pages/Workspace.tsx:4517-4537`
- Test: `__tests__/CostSummaryTab.test.tsx:465,1052-1087`, `__tests__/Landing.test.tsx:235,251`, `__tests__/DataTable.test.tsx:165`, `__tests__/CapabilityMatrixTab*.test.tsx` count literals, `__tests__/Workspace.test.tsx` + `Workspace.Jade.test.tsx` history-position literals
- e2e: `input-tables-qa.spec.ts:133,147`, `quick-fixes.spec.ts:219-225`, `chen-bands-units-qa.spec.ts:565-621` (history position)

**Interfaces:**
- Produces: `DataTableProps.countNoun?: string`. With it, the count reads `${filtered} ${noun}` when unfiltered and `${filtered} of ${total} ${noun}` when filtered. Without it, the current `${filtered} of ${total}` stays.
- Produces: `UNVERIFIED_TOOLTIP` const in `lib/resultOutcome.ts`.

- [ ] **Step 1: Write the failing tests**

- `CostSummaryTab`: the legacy rate suffix reads `"textbook default"` (no `(legacy result)`); the Quality row `"Unverified"` has `title` = `UNVERIFIED_TOOLTIP`.
- `Landing`: `badge-legacy-unverified-30` has that `title`.
- `DataTable`: with `countNoun="plants"` and 4/4 rows, `"4 plants"`; filtered 1/4 gives `"1 of 4 plants"`.
- `Workspace`: after 1 solve, `text-result-history-position` is absent and `button-save-as-scenario` is present; after 2 solves it reads `"Run 2 of 2"`.

- [ ] **Step 2: Run them and confirm they fail; then implement**

- `LEGACY_RATE_LABEL = "textbook default"`.
- `export const UNVERIFIED_TOOLTIP = "Solved before solution quality was recorded. Re-run to verify.";`. Render it as a `title` on the Quality value cell (single and compare) and on the Landing badge.
- DataTable count, as specified. `CapabilityMatrixTab` passes `countNoun="plants"` (the "4 of 4" surface the spec names).
- History pager: wrap back/position/forward in `{resultHistoryState.items.length > 1 && (…)}`. The text becomes `` `Run ${index + 1} of ${items.length}` ``. "Save as scenario" stays gated on `> 0`.

- [ ] **Step 3: Rewrite the literals and run**

- Every `"1/1"` assertion becomes an absence assertion; every `"N/M"` becomes `"Run N of M"`.
- e2e: same rule.

Run: `pnpm run typecheck`, `pnpm --filter studio test`, `typecheck:e2e`. Green.

- [ ] **Step 4: Review + commit**

`[DU-2.4] copy pass: legacy suffix, Unverified tooltip, counted nouns, Run N of M`.

---

### Task DU-2.5: Header title, one primary action, lane-colour mode

**Files:**
- Modify: `pages/Workspace.tsx:4487-4507`, `components/workspace/tabs/CostSummaryTab.tsx:463-472`, `components/workspace/tabs/OptimizationParametersTab.tsx:752`, `components/workspace/StaleOutputBanner.tsx:26`, `components/workspace/super/SuperReadinessPanel.tsx:27`, `components/workspace/tabs/OutputMapTab.tsx:148,208,358-366`
- Test: `__tests__/Workspace.test.tsx:2442-2456,2584-2605`, `__tests__/OutputMapTab.test.tsx:124,208,236,439`, `__tests__/Workspace.Brazil.test.tsx:342`, `__tests__/CostSummaryTab.test.tsx:1230`
- e2e: `max-coverage.spec.ts:157-161`, `jade-two-echelon.spec.ts:143-147`, `design-upgrade-p1.spec.ts:282`, `chen-bands-units-qa.spec.ts:325,360`

**Interfaces:**
- Produces: the testids `workspace-chapter-title` and `workspace-chapter-subtitle` inside `workspace-chapter-summary`.
- Produces: `segmented-lane-colour` with options `segment-lane-colour-band` / `segment-lane-colour-leg` / `segment-lane-colour-none`; the old `checkbox-color-lanes-band` is removed.

- [ ] **Step 1: Write the failing tests**

- Header: `workspace-chapter-title` has `activeChapter.title` (e.g. "AL's Athletics"); `workspace-chapter-subtitle` has the description; the summary still contains "Chapter 3"; actions are not truncated (title and subtitle each carry `truncate`, the actions column does not).
- Buttons: `button-toggle-compare`, `button-tab-solve`, `button-stale-banner-run-optimizer` and `super-open-import` have the outline variant class (`border` and not `bg-primary`); `button-run-optimizer` keeps `bg-primary`.
- Lane colour: on a jade fixture, the segmented control shows "Distance band" + "Leg" with band pressed (`aria-pressed="true"`); clicking Leg clears the band colouring (`mapBands` empty). On p-median it shows "Distance band" + "None". It's disabled when `!showLanes`.

- [ ] **Step 2: Implement**

- Header. The single-line `truncate` moves to each line, and the `md:grid-cols-[minmax(0,1fr)_auto]` grid is unchanged:

  ```tsx
  <div data-testid="workspace-chapter-summary" className="min-w-0">
    <div className="flex items-baseline gap-1.5 min-w-0">
      <span className="scnd-kicker shrink-0">{activeChapter.chapter}</span>
      <span data-testid="workspace-chapter-title" className="scnd-display truncate text-[color:var(--surface-band-fg)]">{activeChapter.title}</span>
    </div>
    <div data-testid="workspace-chapter-subtitle" className="truncate text-2xs text-[color:var(--ink-300)]" title={activeChapter.description}>{activeChapter.description}</div>
  </div>
  ```

- Q4 buttons: add `variant="outline"` to the four in-tab buttons. Leave dialogs unchanged.
- Lane colour. Replace the checkbox with a two-button segmented control (`role="group" aria-label="Lane colour"`, buttons with `aria-pressed`, `min-h-6`). State changes from `colorByBand: boolean` to `laneColour: "band" | "leg" | "none"`; `mapBands = laneColour === "band" ? effectiveBands : []`. The second option's label/value is `"leg"` for `two-echelon-gold-au`/`two-echelon-jade-us`/`super-model`, and `"none"` otherwise. Both non-band values give the same `mapBands`; the label only names what the map then shows.

- [ ] **Step 3: Rewrite the tests and e2e, run, review, commit**

- e2e:
  - `design-upgrade-p1.spec.ts:282` clicks `segment-lane-colour-leg`.
  - `chen-bands-units-qa.spec.ts:325,360` `toBeChecked` becomes `toHaveAttribute("aria-pressed","true")` on `segment-lane-colour-band`.
  - The header specs keep their text assertions, since the description text is still in the summary.
- Run: typecheck, studio test, `typecheck:e2e`.
- Commit `[DU-2.5] header shows chapter title; one filled primary per view; lane colour as a segmented control`.

---

### Task DU-2.6: `DataTable` affordances

**Files:**
- Modify: `components/ui/table.tsx` (`Table` gains `containerClassName?: string`), `components/data-table/DataTable.tsx`, `components/data-table/types.ts` (`loading?: boolean`), `components/data-table/TablePager.tsx`, `components/data-table/entityCells.tsx:36-47` (`StatusToggle`), `components/workspace/tabs/CapabilityMatrixTab.tsx:149-155`, `components/workspace/tabs/WarehousesTab.tsx:186-212` + `CustomersTab.tsx:239-245` + other entity tabs' ID columns, `components/workspace/tabs/{DistancesTab,JadeDistancesTab,DeliveryCostsTab}.tsx` (pass `loading`), `components/workspace/tabs/{JadeDistancesTab,LegDistancesTab}.tsx` (leg column becomes sections)
- Test: `__tests__/DataTable.test.tsx`, `__tests__/usePagedRows.test.tsx`, the `*.dataTable.test.tsx` files listed in the grounding (`DistancesTab:119`, `LegDistancesTab:68,76,84`, `DeliveryCostsTab:101`, `JadeDistancesTab.dataTable:74,108`), `__tests__/JadeDistancesTab.test.tsx:191,208-209`, `__tests__/LegDistancesTab.test.tsx:116,133-162`, `__tests__/DistancesTab.test.tsx:140,788`, `__tests__/Workspace.test.tsx:626`, `__tests__/Workspace.TwoEchelon.test.tsx:227`
- e2e: `bundle6.1-legend-distances.spec.ts:320` (leg badge) + rg for `distances-reference-loading`, `badge-leg-`

**Interfaces:**
- Produces: `DataTableProps.loading?: boolean`. While true, the body renders `DataTableSkeleton` (5 rows × visible columns, `data-testid={testIds.loading ?? "data-table-loading"}`) and **never** `emptyState`.
- Produces: `DataTableTestIds.loading?: string`.

- [ ] **Step 1: Write the failing RTL tests (`DataTable.test.tsx`)**

- `loading` + `rows=[]` + `emptyState="Nothing here"`: the skeleton testid is present and "Nothing here" is absent.
- The header `<thead>` cells carry `sticky top-0 z-10 bg-background`.
- The `Table` wrapper doesn't create its own scroll container (`containerClassName` "overflow-visible"), so the sticky header binds to the caller's `scrollClassName` container.
- The pager wrapper carries `sticky bottom-0 bg-background`.
- An `kind:"text"` column with `id === "id"` has cells with `whitespace-nowrap` and `min-w-[6rem]`.
- `StatusToggle` buttons carry `min-h-6 min-w-6`.

Note in the test file: jsdom can't prove `position: sticky` works. These assert the classes only, and DU-2.9 verifies the behaviour in a real browser.

- [ ] **Step 2: Implement**

- `ui/table.tsx`: `Table` takes `containerClassName` and merges it into the wrapper (`cn("relative w-full overflow-auto", containerClassName)`). Default behaviour is unchanged for other callers.
- `DataTable.renderTable`: `<Table containerClassName="overflow-visible" …>`. `TableHead` adds `sticky top-0 z-10 bg-background`. The caller scroll container (`scrollClassName`, e.g. `max-h-[55vh] overflow-y-auto`) is the sticky ancestor. When a caller passes no `scrollClassName`, default it to `"overflow-auto"` so wide tables still scroll horizontally.
- Pager: `TablePager` wrapper becomes `sticky bottom-0 z-10 bg-background py-1`. It stays outside the scroll container, so it's visible at the table's bottom edge without page scrolling past the table.
- Loading: in the body branch, `if (loading) body = <DataTableSkeleton cols={visibleCols} testId={…} />` takes precedence over both empty and rows. The skeleton is `animate-pulse` rows of `h-3 rounded bg-muted` bars.
- Callers:
  - `DistancesTab` / `JadeDistancesTab` pass `loading={referenceQuery.isLoading}` and delete the separate `*-reference-loading` line.
  - `DeliveryCostsTab` passes `loading` and drops its loading-specific empty copy (the error copy stays as `emptyState`).
- IDs: entity tabs' `id` columns add `cellClassName: "font-mono text-xs whitespace-nowrap min-w-[6rem]"`. The `EntityIdCell` mono sub-label adds `whitespace-nowrap`.
- Targets:
  - `StatusToggle` buttons get `min-h-6 min-w-6 inline-flex items-center justify-center`.
  - `CapabilityMatrixTab` checkbox: wrap it in a `label` hit area `inline-flex h-6 w-6 items-center justify-center` (the visual box stays `h-4 w-4`, since WCAG 2.5.8 counts the target).
  - `LayerCheckbox` is already inside a full-row label; verify in DU-2.9.
- Q6 leg column: in `JadeDistancesTab` and `LegDistancesTab`, drop the `leg` column and pass `sections` grouped by leg (`title` = `LEG_LABEL[leg]`; the unknown-leg section title keeps the red `Badge variant="destructive"` with `AlertTriangle`). Section testids: `section-leg-${leg}`. Filters and pager work per section as `sections` already provides.

- [ ] **Step 3: Rewrite the tests, e2e sweep, run**

- `badge-leg-*` assertions become `section-leg-*` titles.
- `distances-reference-loading` assertions become the skeleton testid.
- The `JadeDistancesTab.dataTable.test.tsx:108` header list drops `"Leg"`.

Run: typecheck, studio test, `typecheck:e2e`.

- [ ] **Step 4: Review + commit**

`[DU-2.6] DataTable: sticky header, pinned pager, loading skeleton, nowrap IDs, 24px targets, leg as group header`.

---

### Task DU-2.7: Entity naming + one tooltip typography

**Files:**
- Modify: `components/NetworkMap.tsx:747-758,810-818,857-863,875-879`, `components/workspace/map/EntityMarkers.tsx:232-235,260-263,280-283`, `components/workspace/tabs/InputMapTab.tsx:1902-1913`, `components/workspace/map/MapDetailsCard.tsx:96-122`, `components/workspace/map/dialogs/EditWarehouseDialog.tsx:77-84`, `EditCustomerDialog.tsx:92-93`, `src/index.css:24-30` (`.nos-map-tooltip` applied to input maps too)
- Create: `components/EntityName.tsx`
- Test: `__tests__/EntityMarkers.test.tsx:472-537`, `__tests__/NetworkMap.test.tsx` (13 tooltip `toContain`s), `__tests__/OutputMapTab.test.tsx:805`, `__tests__/InputMapTabV2.twoEchelon.test.tsx:223,233`, `__tests__/MapDetailsCard.test.tsx:58`, `__tests__/EditWarehouseDialog.test.tsx:61`
- e2e: `workspace-fixups-2.spec.ts:175-178` (`assertTooltipShape`)

**Interfaces:**
- Produces: `<EntityName type?: string; name: string; id: string />`. It renders `` `${type} · ` `` (when given) + the name in sans + ` · ` + the id in `font-mono`. `name` is `formatCityState(city, state)`.

**Canonical shape:** `Warehouse · Chicago, IL · WH-IL-CHI-01`. The type comes first, then the name, then the ID; the city appears exactly once. That order replaces today's `Type · ID · City`.

- [ ] **Step 1: Write the failing tests**

- `EntityMarkers.test.tsx:472` becomes `"Warehouse · Chicago, IL · WH-IL-CHI-01"`, and the id node has `font-mono`.
- `MapDetailsCard` header shows `"Chicago, IL"` + mono `"WH-IL-CHI-01"` (`map-details-code` holds the ID).
- `EditWarehouseDialog` shows `Name: Chicago, IL` and `ID: CHI` (mono), with no "Code" label.
- Both maps' tooltips carry `nos-map-tooltip`.

- [ ] **Step 2: Implement**

- Use `EntityName` in every tooltip, the card header (aria-label becomes `` `${name} (${id}) details` ``), and both edit dialogs (label "Name" + value, "ID" + mono value).
- Add `className="nos-map-tooltip"` to the input-map tooltips.
- The route tooltip `{from.city} → {to.city}` becomes `{formatCityState(from)} → {formatCityState(to)}` (sans), with the distance in mono.
- Output customer tooltip: the demand stays mono after the ID; the band text is already the DU-2.2 range.
- The fixed mine tooltip: `Mine · Kalgoorlie, WA · kalgoorlie (fixed)`.

- [ ] **Step 3: Rewrite the tests + e2e, run**

`assertTooltipShape` regex becomes `` `^${type} · [^,]+, [A-Z]{2,4} · \\S+` ``.

Run: typecheck, studio test, `typecheck:e2e`.

- [ ] **Step 4: Review + commit**

`[DU-2.7] entity naming: name + stable ID everywhere; one tooltip typography`.

---

### Task DU-2.8: P presets, parameter helper text, Landing footer

**Files:**
- Modify: `components/workspace/tabs/OptimizationParametersTab.tsx:366-379,575-598`, `components/workspace/SolveDialog.tsx:176-200`, `components/AppShell.tsx:113-116` (hero footer)
- Create: `lib/pPresets.ts`, `__tests__/pPresets.test.ts`
- Test: `__tests__/OptimizationParametersTab.test.tsx:87,209,220-224,315,688`, `__tests__/Workspace.test.tsx:1392-1799` (`button-p-quick-10` / `-25`), `__tests__/AppShell.test.tsx:199,287-291`, `__tests__/SolveDialog.test.tsx` (helper text)
- e2e: `feedback.spec.ts:47`, `bundle5-homepage-distances.spec.ts:111` (footer)

**Interfaces:**
- Produces: `pPresets(p: number, pMax: number): number[]`, which returns P−2 … P+2 clamped to `[1, pMax]`, deduplicated and sorted.

- [ ] **Step 1: Write the failing tests**

```ts
import { pPresets } from "@/lib/pPresets";
it("P ± 2 clamped to 1..pMax", () => {
  expect(pPresets(3, 50)).toEqual([1, 2, 3, 4, 5]);
  expect(pPresets(1, 50)).toEqual([1, 2, 3]);
  expect(pPresets(26, 26)).toEqual([24, 25, 26]);
  expect(pPresets(2, 2)).toEqual([1, 2]);
});
```
- `OptimizationParametersTab`: with p=7, the presets are `button-p-quick-5` … `-9`.
- The gap field shows the helper "Stop when the solution is within this % of the best possible."; the time limit shows "The solver stops after this many seconds and keeps the best solution found." (testids `text-help-gap`, `text-help-time-limit`). The same helper appears in `SolveDialog`.
- `AppShell` hero: `homepage-credit-footer` is inside the scrolling `<main>` (not a `flex-shrink-0` sibling of it).

- [ ] **Step 2: Implement**

- `lib/pPresets.ts`:

  ```ts
  /** DU-2.8 — quick P choices around the current value; manifests carry no default P. */
  export function pPresets(p: number, pMax: number): number[] {
    const hi = Math.max(1, pMax);
    const out = new Set<number>();
    for (let n = p - 2; n <= p + 2; n++) if (n >= 1 && n <= hi) out.add(n);
    return [...out].sort((a, b) => a - b);
  }
  ```

- `OptimizationParametersTab`: `[2,3,4,10,25].filter(…)` becomes `pPresets(p, pMax)`. The testid scheme is unchanged.
- Helper text: `<p className="text-2xs text-muted-foreground mt-1" data-testid=…>` under each field, in both surfaces.
- Footer: on the hero page only, render `<footer data-testid="homepage-credit-footer" …>` as the last child **inside** `<main className="absolute inset-0 overflow-y-auto z-10">` (drop `flex-shrink-0`), so it scrolls with the content. The non-hero `AppFooter` stays pinned (out of scope).

- [ ] **Step 3: Rewrite the tests + e2e, run, review, commit**

- `button-p-quick-10/-25` assertions become the P±2 set for that test's P.
- Run typecheck, studio test, `typecheck:e2e`.
- Commit `[DU-2.8] P presets = current P ± 2; parameter helper text; Landing footer scrolls with content`.

---

### Task DU-2.9: Phase 2 real-browser QA + sibling sweep (qa-sdet)

**Files:**
- Create: `artifacts/studio/e2e/design-upgrade-p2.spec.ts`
- Reuse: `e2e/helpers/seedSolvedResult.ts`, `e2e/helpers/solvedModelInputs.ts` and `e2e/fixtures/solved/*.json` from DU-1.5. Re-capture only if a fixture can't exercise a surface (document why).
- Modify: any sibling spec the full gate shows is broken by Phase 2. Changelog, flake-registry.

- [ ] **Step 1: Bring up local servers**

Use free ports, per `artifacts/studio/e2e/CLAUDE.md`: `DATABASE_URL="postgresql://shubhamkr@localhost:5432/nos_dev"`, dummy `VITE_POSTHOG_KEY` / `VITE_SENTRY_DSN`.

- [ ] **Step 2: Write `design-upgrade-p2.spec.ts`, iterating over `CHAPTERS` (all 8)**

Each check must be able to fail, with a non-vacuity probe where it's a detector:
- **Sticky header:** scroll a >50-row table container (p-median Customers, JADE Flows) and assert the `th` `getBoundingClientRect().top` equals the container's top ±1px after scrolling.
- **Pinned pager:** the pager's bounding box is within the viewport without scrolling the page, whenever a table shows a pager.
- **Loading:** delay `**/api/**/reference-distances*` by 2s and assert the skeleton testid is visible and the empty-state copy is absent during the delay.
- **Targets:** every `[data-testid^="button-wh-"]`, `[data-testid^="button-customer-"]` and capability checkbox hit area is ≥ 24×24.
- **Band labels:** on JADE and p-median, no visible text matches `/\bBand \d/` (probe: inject a span `Band 9`, assert the detector flags it, remove it). The legend rows read range text.
- **Formatter:** money cells match `/^\$[\d,]+$/`, chips match `/^\$[\d.]+[KMB]$/`, and distance cells match `/^[\d,]+(\.\d{1,2})?( (mi|km))?$/`.
- **Header:** `workspace-chapter-title` equals `chapter.title` for every chapter, and the actions' right edge sits inside the header box (not truncated) at 1024px width.
- **Entity naming:** hover a warehouse marker on both maps; the tooltip matches `^Warehouse · [^,]+, \S+ · \S+`.
- **P presets:** for p=3, the presets are 1–5.
- **Landing footer:** scroll the Landing page and assert the footer moves with it (its `top` changes).

- [ ] **Step 3: Sibling sweep + full e2e gate**

- Grep `artifacts/studio/e2e/` for every string/testid Phase 2 changed: `Band `, `Overflow`, `Units`, `checkbox-color-lanes-band`, `badge-leg-`, `distances-reference-loading`, `text-result-history-position`, `button-p-quick-`, `label-transport-*-unit-`, `"Code"`, `textbook default (legacy result)`.
- Run `E2E_BASE_URL=http://localhost:<studio-port> pnpm e2e:gate`. Fix specs Phase 2 broke; register real load flakes by test name.

- [ ] **Step 4: Visual checks**

Screenshots under the scratchpad:
- JADE flows with sticky header mid-scroll;
- a BandLabel cell row;
- the lane-colour control;
- a tooltip on each map;
- the Landing footer.

Look at them and report.

- [ ] **Step 5: Commit**

`[DU-2.9] Phase 2 real-browser QA across all 8 chapters + sibling sweep`. Stop the servers. Then the lead dispatches the fable reviewer.

---

## Phase 2 close-out

1. Before merging, message the Super Model session about potential conflicts.
2. Run `pnpm gate` serially with zero concurrent vitest, and `E2E_BASE_URL=… pnpm e2e:gate`.
3. Run `/harness-retro DU-2`, then `superpowers:finishing-a-development-branch`.
4. STOP and ask for merge approval. Push and deploy are separate approvals.

## Self-review (writing-plans)

- **Spec coverage, §5.2.1–5.2.8:**
  - 5.2.1 → DU-2.1
  - 5.2.2 → DU-2.2 (guard + rewrites)
  - 5.2.3 → DU-2.3
  - 5.2.4 → DU-2.4
  - 5.2.5 → DU-2.5
  - 5.2.6 → DU-2.6
  - 5.2.7 → DU-2.7
  - 5.2.8 → DU-2.8
  - §8 Phase 2 rows (band-label guard, formatter tests, band-label tests, rewritten tests, real-browser QA) → DU-2.2, DU-2.1, DU-2.9.
  - The §8 row "identical output from studio and server" holds by construction: the authority lives in `@workspace/units`, and the server adopts it in DU-4.2.
- **Fixed interfaces:**
  - `formatDistanceDisplay`, `formatMoney`, `bandRangeLabel`, `BandLabel`, `Chapter.demandUnit` and `DataTable.loading` match master §A verbatim.
  - New interfaces (`formatDistanceNumber`, `formatCoord`, `demandHeader`, `countNoun`, `pPresets`, `EntityName`) are additive and named in their tasks.
- **Name collision resolved:** the existing studio `bandRangeLabel(distance, bands, unit)` (`lib/bands.ts:123`) is deleted in DU-2.2. The fixed units signature takes an index, so a stale studio import fails `tsc`.
