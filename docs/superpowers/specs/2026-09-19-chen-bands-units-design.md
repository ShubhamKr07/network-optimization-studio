# Chapter 4 (Chen's Cosmetics) — Distance Bands, Service-Distance Params, and App-Wide Unit Handling

**Date:** 2026-09-19
**Status:** Design approved — three review rounds resolved (see the three Resolutions sections + verbatim appendices). Ready for implementation plan.
**Scope:** Multi-layer. Frontend (large), backend TS input/export/import contract, manifest, OpenAPI + codegen. **No `solve.py` math OR reporting change. No dataset change. `e2e_accuracy.py` untouched (hard rule #2).** The result-envelope shape is unchanged; stored `inputs` distances and solver I/O stay in each model's canonical unit.

## Background

Chapter 4 `chens-cosmetics-cn` is a China warehouse→customer **service-level** model with two objectives behind one `objective` toggle (`solve_chens`, `artifacts/api-server/src/solver/solve.py:1212`):

- `coverage` — maximize demand within `highServiceDistKm`, s.t. a weighted-average service-distance cap (`avgServiceDistCapKm`, solve.py:1244).
- `min_distance` — minimize demand-weighted distance, s.t. a demand-coverage floor (`coverageFloorDemand`, solve.py:1247).

`highServiceDistKm` / `maxDistKm` / `p` are real solver constraints (solve.py:1225). **`maxDistKm` is a hard routing cap** — no served edge ever exceeds it. **`distanceBands` is NOT used in the optimization** — it is a reporting/visualization lens only. This is the standing project invariant ("Distance bands are a reporting lens, not model constraints").

**Contracts that currently block the desired behavior (found in review):**
- `chensInputsSchema` accepts an optional `distanceBands` then **unconditionally overwrites** it with `[highServiceDistKm, maxDistKm]` on every create/PATCH/import-apply (`artifacts/api-server/src/validation/inputs/chens.ts:100-104,151-159`). The manifest pins `distanceBands.minItems === maxItems === 2` (`solvers/chens-cosmetics-cn/manifest.json:29`) and lists it `required` (line 46). Re-enabling the editor frontend-only would silently discard user bands on Save.
- `solve_chens` hardcodes `metrics.bandCoverage = [{band: high}, {band: max}]` (solve.py:1280-1281) with **cumulative** (`<= band`) semantics, and never reads arbitrary `inp.distanceBands`. `buildServiceStatsRows` serializes that stored `metrics.bandCoverage` (`services/templates.ts:1364-1377`). `lib/bands.ts::computeBandCoverage` uses **exclusive** buckets. Two different meanings live under one "band coverage" label.
- Importable `distances`/`legDistances` files are unitless 4-column CSV `template_version,from_id,to_id,distance` (`services/templates.ts:933-939,1004-1011`; `services/import.ts` `DISTANCES_COLUMNS` line 92 + exact header check ~377-395); `DistanceTemplateRow` has no unit field.
- The 199M hint appears in **two** places: `OptimizationParametersTab.tsx:275-277` and `SolveDialog.tsx:227-229`.
- Chen min-distance objective is hardcoded `demand-km` in `lib/formatObjective.ts:10-16`.
- Workspace reads output bands from the **solve snapshot** that produced the displayed result (`Workspace.tsx:1492-1505,3007-3010`), never from the `localInputs` draft, deliberately protecting current/historical results.
- All 6 chapters are `workspace: true`; the `Studio.tsx` route branch (`App.tsx:74`) is unreachable — **dead code**.

## Locked decisions

| # | Decision | Choice |
|---|----------|--------|
| 1 | Distance bands | **Keep supported, editable for Chen.** Bands are a **live visualization lens** (never feed the solver). Persisting them requires a **backend input-contract change** (stop the overwrite; preserve valid supplied bands; derive `[high,max]` only when a legacy payload omits `distanceBands`). |
| 1b | Band timing | **Live.** Editing bands instantly recolors the current + historical stepped results and recomputes Service Stats + exports from `edges` + current bands, no re-solve. **Supersedes the solve-snapshot invariant for bands only.** |
| 1c | Band ↔ maxDist | **Free bands + overflow bucket** (top-pin dropped — deep-review #2 proved "no overflow" false: a live/historical lens can sit below an already-solved edge). Bands are free (positive, unique, strictly ascending, ≥1); **no coupling to `maxDistKm`**. Any edge beyond the last band routes through the **existing JADE overflow bucket** (`assignBandOrOverflow` / `OVERFLOW_BAND` `band:-1`) on map, Service Stats, and export. One boundary is **conditionally linked to `highServiceDistKm`** (retargets while present; removable; once removed, high edits don't touch bands). |
| 1d | Coverage semantics | **Cumulative + overflow** (reverses the round-2 "exclusive" draft — deep-review #3: the only overflow-aware helper `computeCumulativeBandCoverage` is cumulative, and the other 5 models' live Service Stats are cumulative; exclusive would need a new helper + make Chen inconsistent). Reuse `computeCumulativeBandCoverage` (already appends an `OVERFLOW_BAND` row); wire Chen into `presentationBands` like its siblings; remove the Chen live-recompute guard. Map coloring stays per-edge `assignBandOrOverflow`. Computed from `edges` + live bands, not `metrics.bandCoverage`. |
| 2 | High-service vs avg cap | **Independently editable, seeded to their existing defaults** (`highServiceDistKm=600`, `avgServiceDistCapKm=1000`). **No "same default" coupling** (that would change the default golden). No model/math change. |
| 3 | 199M hint | **Remove from both** `OptimizationParametersTab` and `SolveDialog`. No replacement. Server-side `coverage_floor_infeasible` precheck still guards feasibility. |
| 4 | Hardcoded units | **Remove app-wide** across reachable components. No shared component infers unit from `modelId`. `distanceUnit` stays internal (manifest + persisted + result). |
| 5 | Unit toggle | **Approved** (reverses the earlier "not approved" note — explicit user decision). **Full conversion, app-level, persisted** (`auto|km|mi`). |
| 5b | Export/import files | **Value in current display unit + explicit unit label; SERVER-owned conversion.** Export route gains a validated `unit=km\|mi` query param (default canonical when omitted); the server converts canonical rows and emits the final CSV/JSON tagged with `unit`. The client passes the current display unit. Import reads the file's `unit` and converts to the model's **canonical** unit for storage/solve (storage/solver always canonical). Applies to **every distance-bearing entity — input AND output**: `distances`/`legDistances`/`laneCosts` (importable) + `assignments`/`costSummary`/`serviceStats`/`flows` (output). Entity-specific `DISTANCE_TEMPLATE_VERSION = 2` (global `TEMPLATE_VERSION` stays 1). Backend + OpenAPI contract change. |
| 6 | Objective units | A single typed **objective-format contract** (`lib/objectiveFormat.ts`) mapping `(modelId, objectiveMode, value)` → formatted string using `useDisplayUnit`. `modelId` is used only inside this one contract module, never in shared UI components. |
| 7 | Studio.tsx | **Out of scope (dead code).** Grep-guards + write-path work scope to reachable components. |

## Part A — Distance bands (Chen)

**Backend contract (blocker #1).** `chensInputsSchema`:
- Accept `distanceBands` as a validated array: every value `> 0`, **unique**, **strictly ascending** (ordering enforced at the API boundary, not only in tests), length **≥ 1**. **No `<= maxDistKm` rule and no top-`=maxDistKm` requirement** (bands are free; overflow handles beyond-last). The high boundary is not API-forced (user may retarget/remove it).
- Separately, reject `maxDistKm <= highServiceDistKm` (a solver-parameter invariant independent of bands).
- **Stop the unconditional `[high,max]` overwrite.** Derive `[highServiceDistKm, maxDistKm]` **only** when a payload omits `distanceBands` (legacy/back-compat). A supplied valid array is preserved verbatim.
- Manifest (`solvers/chens-cosmetics-cn/manifest.json`): change `distanceBands` to `minItems: 1` (drop `maxItems`), `items.exclusiveMinimum: 0`. Keep it `required`.
- Update `chens.test.ts`, package/manifest tests, and create/PATCH/import route tests.

**Frontend editor.** Re-enable the chip editor for Chen (`showBandEditor` truthy). Behavior:
- Free bands: add/remove any positive boundary; auto-sorted; duplicates rejected; **removal blocked if it would empty the array** (≥1 boundary always). No maxDist coupling, no locked/non-removable chip, no prune-on-lower logic.
- **Conditionally-linked high boundary:** on a highService edit `oldHigh → newHigh`, retarget a band `=== oldHigh` to `newHigh` **only if present**; else bands unchanged (the user removed it — high edits then don't touch bands). Dedupe; re-sort.
- Add-band guard: reject `≤ 0` and duplicates.
- **Exact default band array (locked): `[600, 1200, 2400, 5000]`** (600 = default high). Migration: existing Chen scenarios keep their stored `[high, max]` (still valid — ≥1, ascending); **no backfill**.

**Live coverage + overflow (blockers #2/#3/#6, decision 1c/1d).** Band coverage is **cumulative + overflow**, reusing the existing `computeCumulativeBandCoverage` (`lib/bands.ts:115+` — cumulative rows + an appended `OVERFLOW_BAND` row). No new helper. Applied in:
- Map coloring — client-side `assignBandOrOverflow` (per-edge exclusive bucket for color; overflow → `OVERFLOW_BAND`), reading the **live band-lens** so edits recolor immediately.
- `ServiceStatsTab` — **wire Chen into the existing `presentationBands` mechanism and remove the deliberate Chen guard** (`ServiceStatsTab.tsx:~191-230`, which currently forces Chen onto frozen `metrics.bandCoverage`). Chen then computes live like its 5 siblings, cumulative labels (`≤ 600 / ≤ 1200 / … / Overflow`). Chen's separate coverage-% KPIs (`details.coveragePct`) are untouched.
- Service Stats **export → server-owned `unit=` route** (decision 5b), consistent with every other export. Since a live band edit must reach the server-computed export, the export reads the **persisted** `inputs.distanceBands` — so the export reflects edits **after Save** (a lens-only Save is non-staling; see below). The on-screen tab is live (pre-Save); the file reflects saved bands. `solve.py` untouched (its Chen `metrics.bandCoverage` becomes unused).

**Band-lens state + non-staling Save (blockers #1/#6/#10, decision 1b).** A **dedicated band-lens state**, seeded from the active scenario's bands and edited by the band editor, drives all displayed-result coloring/coverage (current, unsaved-draft, historical-stepped). **History stepping does NOT overwrite the lens** (result-history nav replaces `localInputs`/`savedInputsRef`, `Workspace.tsx:1454-1469`). Persisting a lens edit **merges only `distanceBands` onto the authoritative latest server inputs** (`currentScenario.inputs`), **never** the displayed history blob — otherwise a bands edit while browsing a `p=3` history entry would PATCH the whole `p=3` blob over the latest `p=5` (deep-review #1, confirmed against `handleSaveInputs` `Workspace.tsx:1703+`, which PATCHes the entire `localInputs`). A distanceBands-only PATCH is non-staling (the backend already skips the stale bump for that case). This supersedes the solve-snapshot read **for bands only**; the underlying result is untouched. Tested: different latest/historical `p` (+ another non-band field) → step back → edit bands → Save → every latest non-band value preserved, scenario non-stale; and stepping history never changes the active lens.

## Part B — High-service vs avg-cap defaults

`defaultInputsForModel` (Chen): `highServiceDistKm=600`, `avgServiceDistCapKm=1000` (existing values, unchanged). Two independent editable fields; editing one never moves the other. **No golden change; the Playwright journey's 66.0639% default result stands.** `solve_chens` unchanged.

## Part C — Remove 199M hint

Delete the `coverage-floor-hint` block in **both** `OptimizationParametersTab.tsx:275-277` and `SolveDialog.tsx:227-229`. Update both test suites (remove the two hint test-ids). Grep-guard asserts the exact phrase `total demand 199M` and the two hint test-ids are absent from `artifacts/studio/src` (not a bare `199`, which `lib/gazetteer-us.json` legitimately contains).

## Part D — App-wide unit de-hardcoding + toggle

### Canonical vs display
- **Canonical unit** = manifest `distanceUnit` (Chen=`km`, others=`mi`). Stored `inputs`, solver I/O, and the result envelope are **always canonical**. **Exported file values are in the display unit** (server-converted, `unit`-labeled — decision 5b); import converts them back to canonical. Files are the only place display-unit numbers persist.
- **Display preference** = global enum `"auto" | "km" | "mi"`, persisted in `localStorage`, default `"auto"`. `auto` → each value in its model's canonical unit (no conversion). `km`/`mi` → every displayed + entered distance converts app-wide. Factor `1 mi = 1.609344 km` exactly.

### Mechanism — `UnitContext` + `useDisplayUnit()` (app root)
```ts
type DisplayUnitPref = "auto" | "km" | "mi";
interface UnitApi {
  pref: DisplayUnitPref;
  setPref(p: DisplayUnitPref): void;                      // writes localStorage
  effectiveUnit(canonical: "km" | "mi"): "km" | "mi";     // pref==="auto" ? canonical : pref
  toDisplay(canonicalValue: number, canonical: "km" | "mi"): number;
  fromDisplay(displayValue: number, canonical: "km" | "mi"): number;
  format(canonicalValue: number, canonical: "km" | "mi", opts?): string;
}
```

**Read path:** every distance label/KPI/table cell/map popup/legend/recent-solve/validation string calls `toDisplay`+`format`. No `"(km)"`/`"(mi)"` literals; no `distanceUnit === ...` / `modelId`-based unit branch in a shared component.

**Write path (blocker #11):** every distance input uses a **raw-string local draft**; on **blur/Enter** it parses, `fromDisplay`-converts to canonical, and writes `localInputs`. Toggling units never mutates `localInputs`, never marks dirty, never changes a save/solve payload; repeated toggles introduce no drift; empty/partial (`5.`) stays editable; presentation rounding is never written back unless the user commits.

**Draft on toggle (blocker #7, decision):** when the toggle flips while an **uncommitted** numeric draft is in a field, the draft **live auto-converts** old→new effective unit and stays uncommitted (e.g. `500` typed under km → `310.686` under mi, still a draft). A non-numeric/partial draft (`5.`, empty) is left verbatim until it parses. Commit still happens on blur/Enter → canonical.

**No fallback-unit write (blocker #7):** no distance write path may use an inferred or `mi` fallback unit while the manifest/canonical unit is still loading (several components fall back to `mi`, e.g. `ServiceStatsTab.tsx:27-31`). Distance editors are **gated/disabled until the canonical `"km"|"mi"` is resolved** (or the resolved canonical is threaded as a required value from an authoritative parent). A delayed-manifest Chen-write test covers this.

**Write-path inventory (blocker #7) — every surface owned + tested:** `OptimizationParametersTab` (high/max/avg-cap/band inputs), `SolveDialog` (its separate avg-cap/band inputs), `DistancesTab` (reference display + existing-row edit + add-row), `LegDistancesTab` (edit + add), `LaneCostsTab` (transport-coal — its `cost` values are distances, convert), `JadeDistancesTab` (separate component + write path), map popups/tooltips + legends, all output grids/KPIs, Landing recent-solves, validation strings. **`Studio.tsx` excluded (dead code).**

**Toggle UI:** compact `auto/km/mi` control in the app header (model screens + Landing).

**What converts (blocker #4/#8).** All **distance-dimension** values convert. **`transport-coal`'s `laneCostOverrides.cost` ARE distances in miles** (`transportLp.ts:18-25`: named `cost` for model vocabulary only; the objective is literally distance×flow) — they **convert** and participate in the unit design. Never convert: demand, `coverageFloorDemand`, `p`, gap, time-limit, and genuinely **monetary** values (`two-echelon-jade-us` only — its objective applies $/ton-mile rates + minimum charges, `solve.py:991-1010`).

### Objective units (blocker #8, decision 6) — six-model contract
Single `lib/objectiveFormat.ts` contract `(modelId, objectiveMode, value, unitApi) → string`; `modelId`/mode referenced **only** here. Consumers (`formatObjective`/`formatChenObjective`, Landing, `ObjectiveBar`, CostSummary, compare) route through it.

| Model | Objective (solve.py) | Dimension | Converts? | Displayed suffix |
|-------|----------------------|-----------|-----------|------------------|
| `p-median-us` | demand × distance (270-271) | demand-distance | yes | `demand-<u>` |
| `p-median-brazil` | demand × distance (614-619) | demand-distance | yes | `demand-<u>` |
| `transport-coal` | distance × flow (439) | flow-distance | yes | `<u>·units` |
| `two-echelon-gold-au` | distance × flow / truckload-kg (792-793) | truckload-distance | yes | `truckload-<u>` |
| `two-echelon-jade-us` | $/ton-mile + min charges (991-1010) | monetary | **no** | `$` |
| `chens-cosmetics-cn` coverage | % demand covered | percent | **no** | `%` |
| `chens-cosmetics-cn` min_distance | demand × distance | demand-distance | yes | `demand-<u>` |

`<u>` = effective display unit. Convert factor `1 mi = 1.609344 km`. Opaque/untyped → unchanged, no invented unit. Tests cover all six models under both display units.

## Part E — Export/import units (decision 5b, deep-review #2/#3/#5/#6/#9)

**Server-owned conversion.** The export route (`GET /scenarios/:id/export`) gains a validated `unit=km|mi` query param; the server converts canonical rows → that unit and emits the final CSV/JSON tagged with `unit`. **Default = canonical** when `unit=` is omitted (old clients / direct-API). The client (`downloadEntityExport`, `exportEntity.ts`) appends the current display unit and writes the returned blob unchanged — no client-side parse/reserialize. Direct-API and app download share one contract.

**Precision / round-trip (deep-review #9).** Exported distances serialized at **4 decimal places**. Round-trip (export display → import → canonical) tolerance: **abs ≤ 0.001 canonical / rel ≤ 1e-5**. No "lossless" claim; tests run repeated export→import cycles against this tolerance.

**Importable input entities — `distances`, `legDistances`, `laneCosts`:**
- **Entity-specific version:** `DISTANCE_TEMPLATE_VERSION = 2`, used **only** for these entities. **Do NOT touch the global `TEMPLATE_VERSION`** (`templates.ts:15-23`, stays `1`). Retain v1 parsing (v1 = unitless, canonical).
- **CSV header (locked), per-entity value column:** `distances`/`legDistances` → `template_version,unit,from_id,to_id,distance`; **`laneCosts` keeps its `cost` column** → `template_version,unit,from_id,to_id,cost` (chapter vocabulary preserved). The serializer/parser take the value-column name per entity. Every row (incl. blank stubs) carries the same valid `unit`+`version`; mixed-version/mixed-unit rows → `format`-class rejection.
- **JSON envelope (locked):** `{templateVersion: 2, entity, unit, rows}` — `unit` on the **envelope only**, never per row. Use distinct internal-canonical / CSV-row / JSON-envelope types (or pass `unit` as a serializer arg) so the row object never carries a duplicated `unit`. **JSON is export-only** (import stays CSV-only: `ImportRequest.csvText` + Papa + `ImportDialog` `.csv,text/csv`; JSON import out of scope).
- **Import unit rule (locked):** read the file's `unit`; a **different-but-known** unit (e.g. a `mi` file into a km-canonical model) is **accepted and converted** to canonical; **mixed** units/versions within one file → `format`; **unknown** unit → `format`.
- Touch: `services/templates.ts` (per-entity row/CSV/JSON writers incl. `LaneCostTemplateRow`/`LaneCostStubRow`/`laneCostRowsToCsv`/`LANE_COST_COLUMNS` + `DISTANCE_TEMPLATE_VERSION`), `services/import.ts` (`DISTANCES_COLUMNS`/`LANE_COST_COLUMNS`, header checks, unit read+convert, v1/v2 branches), export/import routes (`unit=` param), `openapi.yaml` + regen, tests.

**Output entities — `assignments`, `costSummary`, `serviceStats`, `flows` (deep-review #6):** these carry distance-dimension values and **also convert** under `unit=`.
- Rename hardcoded unit-specific columns to neutral + a `unit` column: `flows` `distance_mi`/`distanceMi` → `distance` (+ `unit`) (`templates.ts:1386-1418`); `costSummary` `weightedAvgDistance` carries `unit`; the objective value converts per the **six-model objective contract** (Part D) — distance/demand-distance/flow-distance/truckload-distance convert, jade monetary + Chen coverage-% do not.
- `serviceStats` band boundaries + `distance_unit` follow the `unit=` param; rows are **cumulative + overflow** (decision 1d) — same computed rows the tab shows.
- Version output schemas (`OUTPUT_TEMPLATE_VERSION` bump) since the column set/semantics change; OpenAPI `ExportEnvelope`/entity-row shapes + regen; tests per entity under both units.

## Amendment table — earlier Chapter 4 decisions superseded/revised

| Prior | Was | Now |
|-------|-----|-----|
| D13 | bands derived, non-editable for Chen | editable, live lens (Part A) |
| D19 | overwrite `distanceBands=[high,max]` on every write | preserve supplied bands; derive only when omitted (Part A) |
| D8/D14 | canonical-unit (`km`) labels shown in the UI | unit-neutral + app-wide toggle (Part D) |
| D29 / 5b | (design draft) files canonical + labeled / unitless | versioned unit-labeled files, value in **display** unit, **server-owned `unit=` conversion**, import converts to canonical; input + output entities (Part E) |
| 1d (round-2 draft) | exclusive band buckets | cumulative + overflow, reuse `computeCumulativeBandCoverage` (deep-review #3) |
| solve.py Chen `bandCoverage` | cumulative, 2 fixed rows, authoritative | unused for Chen; coverage computed live from edges+bands, cumulative + overflow (1c/1d) |
| 1c top-pin (round-2 draft) | top band pinned to maxDistKm, prune-on-lower | free bands + overflow bucket, no maxDist coupling (deep-review #2) |

## Non-goals
- No `solve.py` change (math or reporting), no dataset change, no result-envelope shape change.
- No numeric conversion of stored `inputs` or solver I/O (always canonical). Exported **file** values ARE in the display unit (import converts back to canonical) — the only place display-unit numbers persist.
- No coupling of highService and avg-cap.
- No dynamic feasibility message replacing the 199M hint.
- No JSON import path; no global `TEMPLATE_VERSION` bump.

## Review Resolutions (comments 1–12)
1. Accepted — backend input-contract change (Part A); scope reframed (not frontend-only).
2. Resolved — live coverage from edges+bands, **cumulative + overflow** (reuse `computeCumulativeBandCoverage`); `ServiceStatsTab` wired into `presentationBands` (Chen guard removed); export server-owned via `unit=`; solve.py untouched (1d, Part A/E). *(Round-2 "exclusive/client-side" superseded by third re-review #3/#4.)*
3. Resolved — versioned unit label, value in display unit, import converts to canonical (Part E / 5b; further refined by deep-review #3).
4. Resolved — keep defaults 600/1000; drop "same default"; no golden/journey change (Part B / decision 2).
5. Resolved — superseded by deep-review #2: free bands + overflow (no maxDist coupling), enforced UI+API (1c, Part A).
6. Resolved — superseded by deep-review #2: overflow bucket handles beyond-last (the "no overflow" claim was false under a live/historical lens) (1c).
7. Accepted — full write-path inventory; Studio.tsx excluded as dead (Part D / decision 7).
8. Resolved — single objective-format contract, manifest/modelId isolated to that module (Part D / decision 6).
9. Accepted — remove both hints; grep-guard by phrase + test-ids (Part C).
10. Resolved — live lens supersedes snapshot for bands only; tested current/unsaved/historical (1b, Part A).
11. Accepted — raw-string drafts, commit on blur/Enter, no-drift/partial-entry tests (Part D write path).
12. Resolved — exact default `[600,1200,2400,5000]` + migration locked; amendment table added (Part A + amendment table).

## Required tests
1. Chen band editor renders; add/remove bands works end-to-end; removal blocked at the last remaining boundary (≥1).
2. Default bands `[600,1200,2400,5000]`; 600 present (=high).
3. highService change retargets the linked band; others unchanged; no duplicate; re-sorted. High-band removed → later high edit leaves bands untouched.
4. Overflow: a stored edge exceeding the last band lands in the `Overflow` bucket (map + Service Stats + export), not folded into the last band — including after lowering the live lens below an already-solved edge.
5. Add-band rejects `≤0` and duplicates; strictly-ascending preserved.
6. API preserves supplied valid bands (no overwrite); derives `[high,max]` only when omitted; rejects unordered/non-unique/empty and `maxDistKm ≤ highServiceDistKm` at the boundary; manifest `minItems:1` tests updated.
7. Live coverage: editing the band-lens recolors current + historical stepped results and updates `ServiceStatsTab` without re-solve (**cumulative + overflow**, `≤band` labels + `Overflow` row); stepping history does not change the active lens. Save merge: different latest/historical `p` (+ another non-band field) → step back → edit bands → Save → all latest non-band values preserved, scenario non-stale (deep-review #1). Export via `unit=` reflects saved bands.
8. 199M hint gone from both `OptimizationParametersTab` and `SolveDialog`; grep-guard on the phrase + both test-ids.
9. `useDisplayUnit`: `auto` no-op; `km`/`mi` convert at `1 mi=1.609344 km`; `toDisplay∘fromDisplay` round-trips.
10. Toggle persists across reload (localStorage).
11. Write path: typing `500` in `mi` while canonical is `km` stores `804.672`; toggling never mutates `localInputs`/dirty/payload; no drift on repeated toggles; partial entry stays editable; **uncommitted draft live-converts on toggle**; **distance editor gated until canonical unit resolves** (delayed-manifest Chen write).
12. Non-distance fields (demand, coverageFloorDemand, p, gap, time, jade monetary objective) unaffected by the toggle.
13. Objective contract — all six models under both display units: p-median-us/brazil demand-distance (convert), transport-coal flow-distance (convert), two-echelon-gold truckload-distance (convert), jade monetary (no convert), Chen coverage % (no convert) / min-distance demand-distance (convert).
14. Export/import: server `unit=` round-trip within tolerance (export display @4dp → import → canonical, abs ≤ 0.001 / rel ≤ 1e-5, repeated cycles); **different-but-known** unit (mi file → km model) accepted+converted; **mixed** units/versions rejected (`format`); **unknown** unit rejected (`format`); old v1 unitless imports as canonical; global `TEMPLATE_VERSION` unchanged; blank-stub carries unit+version; `laneCosts` v2 keeps its `cost` column; `unit=` omitted → canonical (default).
15. Output exports (`assignments`/`costSummary`/`serviceStats`/`flows`) convert under `unit=`: `flows` neutral `distance`+`unit` (no `distance_mi`), `costSummary` objective converts per the six-model contract (+ `weightedAvgDistance` unit), `serviceStats` cumulative+overflow rows under the requested unit; output schema versions bumped.
16. Solver/accuracy unaffected: `e2e_accuracy.py` 99/99 unmodified; solver pytest green; default Chen scenario still 66.0639%.

## Verification gate
`pnpm run typecheck && pnpm --filter studio test && pnpm --filter api-server test` + solver pytest + `e2e_accuracy.py` (unchanged — no Python touched) + OpenAPI regen committed with its spec change. Real-browser `qa-sdet` Playwright per standing plan-QA rule: band edit + live recolor + overflow + high-link sync + non-staling lens Save while browsing history, unit toggle full conversion + persistence + no-drift, 199M hint gone, `unit=` export round-trip (input + output entities).

## Deep Re-review Resolutions (deep-review #1–#8)
1. **Live Service Stats export** — *(revised by third re-review #1/#2: export is server-owned via `unit=` reading persisted bands; the on-screen tab is live pre-Save, the file reflects saved bands; a lens-only Save is non-staling and merges onto latest server inputs — see Part A/E.)*
2. **Overflow under live bands** — top-pin dropped; free bands + existing JADE overflow bucket everywhere; test with a stored edge beyond a lowered lens (1c, Part A, test 4).
3. **Distance-file v2 defined** — entity-specific `DISTANCE_TEMPLATE_VERSION=2` (global `TEMPLATE_VERSION` untouched); locked CSV `template_version,unit,from_id,to_id,distance`; JSON `{templateVersion:2,entity,unit,rows}` export-only; import CSV-only; v1 back-compat (Part E).
4. **Objective mapping corrected** — six-model table; transport = flow-distance (converts), jade = monetary (no convert), gold = truckload-distance, p-median = demand-distance (Part D table).
5. **Coverage semantics** — *(revised by third re-review #3: **cumulative + overflow**, not exclusive; reuse `computeCumulativeBandCoverage`, cumulative labels `≤600 / ≤1200 / … / Overflow`; no new helper, no rounding-apportionment rule needed; consistent with the 5 sibling models — Part A/1d.)*
6. **Stable band-lens** — dedicated lens state independent of history stepping (history nav replaces `localInputs`, so the lens can't just read it); editing the lens never mutates unrelated inputs (Part A band-lens, test 7).
7. **No fallback-unit write** — distance editors gated until canonical unit resolves; delayed-manifest test. Draft-on-toggle rule = live auto-convert (Part D write path, test 11).
8. **Band invariants** — reject `maxDistKm ≤ highServiceDistKm`; strictly ascending in the backend contract; high boundary conditionally linked (removable); `minItems:1`; removal blocked at last boundary; legacy `[high,max]` valid (Part A, tests 1/3/6).

## Third Deep Re-review Resolutions (third-review #1–#10)
1. **Lens Save can't clobber current inputs** — persist a lens edit by merging **only `distanceBands` onto latest server inputs** (`currentScenario.inputs`), never the history blob; distanceBands-only PATCH is non-staling (Part A band-lens; test 7).
2. **Export owner locked** — **server-owned** `unit=km|mi` query param (default canonical); one CSV/JSON serialization path; client passes display unit, writes blob unchanged (Part E; decision 5b).
3. **Coverage helper exists** — reverse to **cumulative + overflow**, reuse `computeCumulativeBandCoverage`, remove the Chen guard, wire `presentationBands`; no new helper, no apportionment rule (1d; Part A).
4. **Service Stats versioning** — output schemas versioned (`OUTPUT_TEMPLATE_VERSION` bump); cumulative-with-overflow rows carry `unit`; the value change is versioned, not silent (Part E output entities; test 15).
5. **File v2 internal types + laneCosts** — distinct canonical-row / CSV-row / JSON-envelope types (`unit` on envelope only); **`laneCosts` keeps its `cost` column** (per-entity value-column); lane-cost row/stub/writer/parser/route all enumerated; import rule locked (known→convert, mixed/unknown→reject) (Part E; tests 14).
6. **Output-export units defined** — output files **convert** under `unit=`: `flows` neutral `distance`+`unit`, `costSummary` objective per six-model contract + `weightedAvgDistance` unit, `serviceStats` cumulative+overflow; schemas versioned (Part E output entities; test 15).
7. **Draft authored-unit** — every draft retains the effective unit it was typed in; on toggle convert once syntactically complete, else preserve+commit under the original unit; tests for empty/`-`/`.`/`5.`/exponent/becomes-valid-after-toggle (Part D; test 11).
8. **Read-path no-fallback** — reads also gated: loading placeholder until canonical unit resolves; delayed-manifest test proves neither value nor label renders in the wrong unit (Part D; test 11).
9. **Round-trip tolerance** — 4-decimal serialization; abs ≤ 0.001 canonical / rel ≤ 1e-5; "lossless" dropped; repeated-cycle test (Part E; test 14).
10. **Stale text fixed** — canonical-vs-display line (files are display unit), Review-Resolution 2, verification gate (top-pin removed), status/amendment rows all corrected.

---

## Appendix — Original review comments (2026-09-19, verbatim; all resolved above)

**Review verdict:** Not ready for an implementation plan. The product direction is clear, but three
locked decisions conflict with current backend/file contracts. Resolve comments 1–4 before planning;
fold comments 5–12 into the design's acceptance criteria and test matrix.

### 1. BLOCKER — editable Chen bands are discarded by the API
`chensInputsSchema` accepts an optional `distanceBands` then overwrites it with
`[highServiceDistKm, maxDistKm]` (`chens.ts:100-104,151-159`) on every write. Manifest advertises
`distanceBands.minItems === maxItems === 2` (`manifest.json:29`). Frontend-only re-enable would drop
user bands on Save. Correction: remove the overwrite, preserve supplied bands, derive `[high,max]` only
when omitted, lock empty/min/max count, validate at the API boundary, update manifest+tests, reframe scope.

### 2. BLOCKER — `solve_chens` does not report arbitrary bands
`solve_chens` hardcodes `metrics.bandCoverage = [{band:high},{band:max}]` (`solve.py:1280-1281`),
never reads `inp.distanceBands`. `buildServiceStatsRows` serializes stored `metrics.bandCoverage`
(`templates.ts:1364-1377`). Custom bands won't appear in ServiceStats/CSV. Correction: reporting-only
solve.py change OR move every consumer (incl. backend export) to edges+snapshot-bands. Lock cumulative
(`<=band`) vs exclusive (`lib/bands.ts`) semantics.

### 3. BLOCKER — explicit units in importable files require a backend contract change
`DistanceTemplateRow` has no unit field; CSV is `template_version,from_id,to_id,distance`
(`templates.ts:933-939,1004-1011`); `import.ts` requires that exact 4-col header (`DISTANCES_COLUMNS`
line 92, ~377-395). Choose: (1) canonical, model-implicit, unitless — revise 5b; or (2) explicit
labeling — versioned format + templates/importer/routes/OpenAPI/tests. Not frontend-only.

### 4. HIGH — the proposed 600/600 defaults change the default golden
Tightening avg cap 1000→600 changes the default outcome: coverage 64.8234% / covered 129173484 /
open {wh-40,wh-102,wh-147} (not 66.0639% / 131645389 / {wh-40,wh-69,wh-102}); weighted avg 582.58.
Playwright journey freezes 66.0639% (`chens-cosmetics.spec.ts:147-167`). Retain cap=1000 OR define a new
app-default golden + update the journey.

### 5. HIGH — behavior when `maxDistKm` invalidates existing bands is undefined
Lowering `maxDistKm` can make stored bands invalid immediately. Lock one: reject the max edit; prune
bands above with confirmation; or drop the `<=maxDistKm` rule. Enforce in API too.

### 6. HIGH — removing the final boundary can misclassify overflow routes
`assignBand` folds beyond-last into the last band (`bands.ts:30-37`). Require a non-removable
max-synchronized boundary or an explicit `> last` overflow bucket; same semantics for maps/ServiceStats/exports.

### 7. HIGH — the app-wide unit write-path inventory is incomplete
Must own+test: `OptimizationParametersTab`, `SolveDialog`, `DistancesTab` (display+edit+add),
`LegDistancesTab`, `JadeDistancesTab`, map popups/legends, output grids/KPIs, recent solves, validation,
and `Studio.tsx` if in supported scope. Every write asserts convert-to-canonical before `localInputs`;
every read asserts convert exactly once.

### 8. HIGH — demand-distance objectives lack a conversion contract
Chen min-distance is demand×distance, hardcoded `demand-km` (`formatObjective.ts:10-16`). Under mile
pref both number+suffix convert. Rule: coverage % unchanged; distance/demand-distance convert; monetary/
demand/floor/p/gap/time unchanged; opaque unchanged. Needs manifest/result metadata or a separate typed
formatter contract shared by formatChenObjective/Landing/ObjectiveBar/CostSummary/compare.

### 9. HIGH — remove the 199M hint from both UI surfaces; replace the grep guard
Hint also in `SolveDialog.tsx:227-229`. `no 199 literal` can't pass (`gazetteer-us.json` has many).
Assert absence of the exact `total demand 199M` phrase + the two hint test-ids.

### 10. MEDIUM — immediate band recoloring contradicts the solve-snapshot invariant
Workspace reads output bands from the solve snapshot (`Workspace.tsx:1492-1505,3007-3010`), not the
draft. Lock: live viz preference (may reclassify solved edges) OR solve-versioned (effect after
Save/Solve). If live, supersede the invariant + test current/unsaved/historical.

### 11. MEDIUM — converted controlled-input precision and partial entry are unspecified
`format()` isn't suitable as a controlled input value. Require raw string drafts + a defined commit
boundary (blur/Enter). Test: toggling never mutates localInputs/dirty/payload; no drift; empty/partial
editable; unfinished-draft unit switch defined; rounding not written back unless committed.

### 12. MEDIUM — lock defaults and explicitly supersede the earlier Chen spec
Fix the exact default band array + migration here. Add an amendment table (D13, D19, D8/D14, D29/5b).

### Review verification performed
Read current frontend surfaces, Chen Zod validator, manifest, import/export templates, solver reporting
code, unit/band tests. Ran one read-only `solve_chens` diagnostic for 600/600 (comment 4). No
implementation files modified; full suite not run during review.

---

## Appendix — Deep re-review comments (2026-09-19, verbatim; all resolved above)

**Review verdict:** Not ready for implementation planning. The earlier review materially improved the
design, but the "approved/all resolved" status was premature. Resolve comments 1–3 before planning and
fold comments 4–8 into the contracts and required-test matrix.

### 1. BLOCKER — live Service Stats export cannot work as specified
Decision 1b requires unsaved band edits to update exports without solving, while Part A says the backend
export recomputes from persisted bands after Save. Neither works: before Save the backend can't see the
browser `localInputs` draft; after Save, changing bands sets `inputsUpdatedAt` making the result stale;
the output-export route rejects a stale scenario (`routes/scenarios.ts:505-507`); a historical result view
still reads the scenario's latest stored result (no run id). Correction: lock one executable export
architecture. Recommended: generate Chen Service Stats CSV client-side from `displayedResult.edges` + live
band lens. Tests must cover unsaved/saved-stale/latest/historical exports.

### 2. BLOCKER — "no overflow possible" is false for live bands
`maxDistKm` is a hard cap for the solve that consumed it, not a retroactive cap on stored edges. A result
solved at max=5000 may contain a 2400-km edge; lowering the live max to 1000 pins the top band to 1000 but
the displayed result still has the 2400-km edge → `assignBand` folds it into the last bucket. Decision 1c /
resolution 6 don't eliminate overflow once bands/max are live over old results. Recommended: explicit
`> top boundary` overflow bucket on map/ServiceStats/export. Add a test whose stored edge exceeds the
lowered maximum.

### 3. BLOCKER — distance-file v2 is not sufficiently defined
"Bump `template_version`" must not change the shared `TEMPLATE_VERSION` (`templates.ts:15-23`, kept at 1;
the importer checks exact versions for all input entities). JSON contract ambiguous (`{unit,rows}` vs
`{templateVersion,entity,rows}`; unit per-row vs envelope). Import is CSV-only (`ImportRequest.csvText`,
Papa, `ImportDialog` `.csv,text/csv`). Correction: entity-specific `DISTANCE_TEMPLATE_VERSION=2` for
distances/legDistances incl. blank stubs, retain v1; lock CSV `template_version,unit,from_id,to_id,distance`
(every row same unit+version, mixed rejection); lock JSON `{templateVersion:2,entity,unit,rows}`, state
JSON export-only (JSON import needs a new request/parser/UI); don't place `unit` both on envelope and rows.

### 4. HIGH — the objective-format mapping is factually incomplete
p-median-us demand×distance (270-271); p-median-brazil demand×distance (614-619); transport-coal lane
value×flow (439) where base lane values are geographic mile distances (manifest `mi`, same values feed
`edge.distance`/weighted-avg) — treating as monetary is unsupported; two-echelon-gold distance×flow/truckload
kg (792-793); jade monetary via $/ton-mile + minimum charges (991-1010); Chen coverage percent, min-distance
demand-distance. Correction: six-model table (dimension, canonical suffix, converts?, displayed suffix);
resolve transport's domain — if distances, objective + `laneCostOverrides` participate in unit design.

### 5. HIGH — exclusive buckets need interval labels and a versioned export contract
`ServiceStatsTab` labels rows `≤ band` "within" (cumulative wording); exclusive needs intervals
(`≤600`, `600–1200`, …) + overflow. Service Stats v2 row `{templateVersion,band,distanceUnit,percent}` —
reusing while silently changing `percent` cumulative→exclusive is a breaking change. Bump the Service Stats
entity version or add `lowerBound`/`upperBound`/`bucketSemantics`; update UI copy, CSV/JSON, OpenAPI, tests;
prove intervals exclusive and account for 100% incl. overflow.

### 6. HIGH — "current bands on historical results" lacks a stable state source
Result-history navigation replaces both `localInputs` and `savedInputsRef.current` with the selected entry's
inputs (`Workspace.tsx:1454-1469`), so switching consumers from `displayedInputs` to `localInputs` doesn't
give a stable live band source — stepping history changes it. Introduce a separate band-lens state
independent of history nav, or redefine as "selected snapshot's bands + subsequent draft edits". Tests must
identify which bands stay active while stepping and ensure lens edits can't replace unrelated inputs.

### 7. HIGH — canonical-unit loading needs a fail-safe write rule
Components fall back to `mi` while manifests load (`ServiceStatsTab.tsx:27-31` + Workspace call sites); a Chen
input committed before `km` resolves converts with the wrong canonical. No distance write path may use an
inferred/fallback unit — gate/disable editors until canonical known, or thread a required `"km"|"mi"`. Add a
delayed-manifest Chen-write test. Also define the unfinished-draft toggle rule (commit under old unit /
cancel-rebase / retain with its unit).

### 8. MEDIUM — band-editor invariants and tests remain incomplete
Reject `maxDistKm <= highServiceDistKm`; prevent removal below the minimum boundary count; state whether the
high boundary is truly vs conditionally linked; state "strictly ascending" in the backend contract (not only
in a test). Add UI+API tests for `newMax<=high`, removal at the minimum, high-band removal then a high edit,
and strictly-ascending preservation/rejection.

### Re-review verification performed
Read the revised design against the current Workspace history/dirty-state impl, output export staleness gate,
Service Stats UI/export contract, input template versioning, CSV-only importer, manifests, and all six solver
objectives. No implementation files or tests changed or run during this document review.

---

## Appendix — Third deep re-review comments (2026-09-20, verbatim; all resolved above)

**Review verdict:** Not ready for implementation planning. The free-band/overflow direction and six-model
objective table are strong improvements, but three blockers and seven additional contract gaps remain.
Resolve comments 1–3 before planning and fold comments 4–10 into the locked contracts and required tests.

### 1. BLOCKER — saving a band lens while browsing history can overwrite current inputs

The dedicated band-lens state prevents history navigation from changing the displayed lens, but Part A
still says a lens edit writes `distanceBands` into `localInputs` for persistence. Result-history navigation
currently replaces both `localInputs` and `savedInputsRef.current` with the selected historical entry's
complete input snapshot (`Workspace.tsx:1511-1527`). `handleSaveInputs` then PATCHes that entire
`localInputs` object (`Workspace.tsx:1703-1741`).

Failure case:

1. The latest scenario inputs have `p=5`.
2. The user steps back to a result produced with `p=3`; history navigation puts that old blob into
   `localInputs` and `savedInputsRef`.
3. The user edits only the independent band lens.
4. Save sends the historical `p=3` blob plus the new bands.

The client may classify this as a bands-only edit relative to the historical `savedInputsRef`, but the
server compares against the actual latest stored scenario and sees multiple changed keys. It therefore
overwrites current non-band inputs and marks the scenario stale. A separate display state alone does not
prevent this persistence bug.

Correction: persist the lens by atomically merging only `distanceBands` onto the authoritative latest
scenario inputs, not onto the displayed history entry's blob. Prefer a field-scoped/optimistic-concurrency
PATCH contract, or explicitly merge with the latest server `currentScenario.inputs` immediately before
Save. Add a test with different latest/historical `p` (and another non-band field): step back, edit bands,
Save, then assert every latest non-band value is preserved and the scenario remains non-stale.

### 2. BLOCKER — display-unit file export has no single executable owner

The document currently contains incompatible contracts:

- Decision 5b and Part E say exported distance-file values use the current display unit.
- Canonical-vs-display line 74 says export-file values are always canonical.
- The touch list says backend CSV/JSON writers produce v2 files.
- It also says the client converts to display unit before writing the Blob.

Today `downloadEntityExport` requests the final requested format from the server and writes the returned
string/object directly to a Blob (`exportEntity.ts:15-29`). The backend does not know the browser's unit
preference. A client cannot convert a server-generated CSV without parsing and reserializing it, and doing
so would make the server's direct CSV contract differ from the app download contract.

Correction: choose exactly one architecture:

- **Server-owned:** add a validated `unit=km|mi` export query parameter; the server converts canonical rows
  and emits the final CSV/JSON/stub contract; or
- **Client-owned:** always request typed canonical JSON for these entities, convert rows client-side, and
  serialize both CSV and JSON locally. The backend CSV endpoint must then either remain an explicitly
  canonical API contract or be removed/redirected for v2; direct API behavior must be documented.

Lock the owner for normal exports, blank stubs, CSV, JSON, and direct API consumers. Add tests proving the
unit label and numeric values come from the same conversion path.

### 3. BLOCKER — the assumed exclusive overflow-aware coverage helper does not exist

Part A says Chen can reuse the existing JADE overflow-aware coverage helper. The existing
`computeCumulativeBandCoverage` is explicitly **cumulative**, not exclusive (`lib/bands.ts:115-142`).
`ServiceStatsTab` currently uses that cumulative helper whenever `presentationBands` is wired and has a
separate Chen-only guard that deliberately prevents live recomputation (`ServiceStatsTab.tsx:191-230`).

Simply wiring Chen into `presentationBands` would either keep Chen frozen or change the semantics of every
other model. Correction:

- Add a distinct helper such as `computeExclusiveBandCoverageWithOverflow`.
- Give `ServiceStatsTab` an explicit coverage-semantics discriminator, or pass already-computed rows, so
  Chen can be exclusive while existing models remain cumulative.
- Update interval labels and export to consume the exact same computed rows.

The requirement that displayed percentages “sum to 100%” also needs a rounding/apportionment rule.
Independently rounding three 33.33% buckets yields 99%. Define a deterministic largest-remainder/final-row
adjustment, or replace exact-sum assertions with a documented tolerance.

### 4. HIGH — client-side generation does not remove the Service Stats versioning break

The existing Service Stats v2 schema is
`template_version,band,distance_unit,percent`, with cumulative semantics. A Chen client-generated file using
the same version and columns but exclusive semantics silently changes what `percent` means. Consumers do
not know or care whether the file was generated in the browser or API.

Correction: bump the Chen Service Stats file version or add explicit fields such as `lower_bound`,
`upper_bound`, `bucket_semantics`, and `is_overflow`. Lock exact CSV and JSON shapes and the display/canonical
unit rule for the band boundaries. The existing UI exposes only CSV, so either add a JSON action or stop
promising client-generated JSON.

### 5. HIGH — distance-file v2 remains internally contradictory, especially for laneCosts

Part E says JSON carries `unit` on the envelope only, but the touch list says to add `unit` to
`DistanceTemplateRow`; the same row object is currently placed into JSON, which would duplicate the unit
inside every row. Use separate internal/canonical row, CSV-row, and JSON-envelope types or pass unit as a
serializer argument.

The single locked v2 CSV header ends in `distance`, while the existing `laneCosts` contract deliberately
uses `cost` (`LaneCostTemplateRow`, `LaneCostStubRow`, `laneCostRowsToCsv`, and `LANE_COST_COLUMNS`). The
touch list names only `DistanceTemplateRow`/`DISTANCES_COLUMNS` and omits the lane-cost row/stub/writer/parser
and route branches.

Correction: explicitly decide whether laneCosts v2 preserves the chapter vocabulary (`cost`) or standardizes
to `distance`. List and test every affected lane-cost type, serializer, stub, parser, route, and v1→v2
compatibility branch.

Required test 14 also contradicts Part E: Part E accepts any known convertible `km`/`mi` unit and converts
it to canonical, while the test says a “mismatched” unit is rejected. Lock the rule as:

- different but known unit (`mi` file into a canonical-km model): accepted and converted;
- mixed units/versions within one CSV: rejected as format;
- unknown unit: rejected as format.

### 6. HIGH — output-export unit behavior is undefined

“Every distance-bearing entity” currently enumerates only the three importable input entities. Existing
output exports also carry distance-dimension values: assignments, Cost Summary, Service Stats, and flows.
Flows still hardcode `distanceMi` / `distance_mi` (`templates.ts:1386-1418`). Cost Summary carries both an
objective that may be distance-dimensional and `weightedAvgDistance`.

Correction: explicitly lock whether output files remain canonical or follow the display preference. If
they convert, version their schemas, rename unit-specific columns, convert objective values according to
the six-model contract, and test them. If they stay canonical, say so and narrow Part E to “importable
distance-input entities”; do not claim every distance-bearing entity or every exported distance converts.

### 7. HIGH — partial drafts can silently change meaning across a unit toggle

The draft rule leaves a partial string such as `5.` verbatim during a unit switch. `parseFloat("5.")` is
already numeric, and if the user later completes/commits it, the same characters are interpreted under the
new effective unit even though they were typed under the old unit.

Correction: every draft must retain the effective unit in which it was authored. On a toggle, either
convert it once it becomes syntactically complete, block the toggle while an incomplete draft exists, or
preserve and commit using the draft's original unit. Add tests for empty, `-`, `.`, `5.`, exponent forms,
and a draft that becomes valid only after the toggle.

### 8. MEDIUM — no-fallback correctness must cover read paths too

Part D correctly gates writes until canonical metadata resolves, but reachable read paths currently fall
back to `mi` while manifests load. Chen can therefore briefly show a kilometre value labelled as miles.

Correction: use authoritative result/manifest metadata or a loading placeholder until canonical unit is
known. Add a delayed-manifest test proving neither the numeric value nor label renders in the wrong unit.

### 9. MEDIUM — “full precision → lossless” needs a numeric tolerance contract

Floating-point km↔mi conversion is not mathematically lossless after decimal serialization and conversion
back to canonical. Lock the serialization precision/significant digits and an absolute or relative
round-trip tolerance. Test repeated export→import cycles against that tolerance and avoid exact-equality or
“lossless” claims unless values are represented as exact decimal/rational strings.

### 10. MEDIUM — stale text still contradicts the revised decisions

Remove or correct the following before declaring the design resolved:

- Canonical-vs-display line 74: says export-file values are always canonical.
- Review Resolution 2: still says backend `buildServiceStatsRows` recomputes Chen, while Part A now says
  Chen export is client-side and the backend is unchanged.
- Verification gate: still requires “top-pin,” although top-pin was explicitly dropped.
- Status/readiness and “all resolved” wording.

### Third re-review verification performed

Reviewed the authoritative `chen-bands-units` branch at commit `02c4cc3` against the current Workspace
history/save behavior, distanceBands-only non-staling PATCH logic, client/server export path, distance and
lane-cost template contracts, CSV-only importer, Service Stats presentation mechanism, band helpers, and
output export schemas. No implementation files or tests were changed or run during this document review.
