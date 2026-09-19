# Chapter 4 (Chen's Cosmetics) — Distance Bands, Service-Distance Params, and App-Wide Unit Handling

**Date:** 2026-09-19
**Status:** Design approved — two review rounds + deep re-review all resolved (see Review Resolutions and Deep Re-review Resolutions). Ready for implementation plan.
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
| 1d | Coverage semantics | **Exclusive** buckets everywhere (map colors, Service Stats, exports) — matching `lib/bands.ts`. Supersedes `solve_chens`'s cumulative rows, which become **ignored** for Chen. Computed from `edges` + bands, not from `metrics.bandCoverage`. |
| 2 | High-service vs avg cap | **Independently editable, seeded to their existing defaults** (`highServiceDistKm=600`, `avgServiceDistCapKm=1000`). **No "same default" coupling** (that would change the default golden). No model/math change. |
| 3 | 199M hint | **Remove from both** `OptimizationParametersTab` and `SolveDialog`. No replacement. Server-side `coverage_floor_infeasible` precheck still guards feasibility. |
| 4 | Hardcoded units | **Remove app-wide** across reachable components. No shared component infers unit from `modelId`. `distanceUnit` stays internal (manifest + persisted + result). |
| 5 | Unit toggle | **Approved** (reverses the earlier "not approved" note — explicit user decision). **Full conversion, app-level, persisted** (`auto|km|mi`). |
| 5b | Export/import files | **Explicit unit label, versioned file format, value in current display unit.** Export writes the value in the current **display** unit tagged with an explicit `unit` field; the toggle **does** change exported contents (store full precision → lossless). Import **reads the file's `unit` label and converts to the model's canonical unit** for storage/solve (storage is always canonical; the solver only reads canonical). Applies to every distance-bearing entity: `distances`, `legDistances`, `laneCosts`. Entity-specific `DISTANCE_TEMPLATE_VERSION = 2` (NOT the global `TEMPLATE_VERSION`, which stays 1). Backend + OpenAPI contract change. |
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

**Live coverage + overflow (blockers #2/#6, decision 1c/1d).** Band coverage is computed from `result.edges` + current bands using **exclusive** semantics + an **explicit overflow bucket** (edges beyond the last boundary → `OVERFLOW_BAND`), reusing the existing JADE helpers (`assignBandOrOverflow`, overflow-aware coverage, `lib/bands.ts:78+`). Applied in:
- Map coloring — client-side `lib/bands.ts` overflow-aware helpers, reading the **live band-lens** (see below) so edits recolor immediately.
- `ServiceStatsTab` — wire Chen into the existing `presentationBands` mechanism (currently excludes Chen), rendering **interval labels** (`≤ 600`, `600–1200`, `1200–2400`, `2400–5000`, `Overflow`) instead of the cumulative `≤ band` labels; percents are exclusive and sum to 100% including overflow.
- Export (Chen **Service Stats → client-side**, blocker #1): the CSV/JSON is generated client-side from `displayedResult.edges` + the live band-lens (same overflow-aware exclusive helper as the tab). This **sidesteps the stale-export gate** (`routes/scenarios.ts:505`, which 422s a stale scenario) and needs **no API change and no `solve.py` change** (its `metrics.bandCoverage` stays unused for Chen). Other models' backend Service-Stats export is unchanged.

**Band-lens state (blocker #10/#6, decision 1b).** A **dedicated band-lens state**, seeded from the active scenario's bands and edited by the band editor, drives all displayed-result coloring/coverage (current, unsaved-draft, and historical-stepped). **History stepping does NOT overwrite the lens** (result-history nav currently replaces `localInputs`/`savedInputsRef`, `Workspace.tsx:1454-1469` — the lens must be independent of that). Editing the lens writes only `distanceBands` into `localInputs` (for Save persistence) and never mutates unrelated inputs. This supersedes the solve-snapshot read **for bands only**; the underlying result (objective, edges, assignments) is untouched. Tested against current, unsaved-draft, and historical-stepped results, and that stepping history does not change the active lens.

## Part B — High-service vs avg-cap defaults

`defaultInputsForModel` (Chen): `highServiceDistKm=600`, `avgServiceDistCapKm=1000` (existing values, unchanged). Two independent editable fields; editing one never moves the other. **No golden change; the Playwright journey's 66.0639% default result stands.** `solve_chens` unchanged.

## Part C — Remove 199M hint

Delete the `coverage-floor-hint` block in **both** `OptimizationParametersTab.tsx:275-277` and `SolveDialog.tsx:227-229`. Update both test suites (remove the two hint test-ids). Grep-guard asserts the exact phrase `total demand 199M` and the two hint test-ids are absent from `artifacts/studio/src` (not a bare `199`, which `lib/gazetteer-us.json` legitimately contains).

## Part D — App-wide unit de-hardcoding + toggle

### Canonical vs display
- **Canonical unit** = manifest `distanceUnit` (Chen=`km`, others=`mi`). Stored `inputs`, solver I/O, result envelope, and export file values are **always canonical**.
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

## Part E — Export/import unit label (decision 5b, deep-review #3)

Versioned file format for every distance-bearing entity: `distances`, `legDistances`, `laneCosts`.
- **Entity-specific version:** introduce `DISTANCE_TEMPLATE_VERSION = 2`, used **only** for these entities. **Do NOT touch the global `TEMPLATE_VERSION`** (`templates.ts:15-23`, stays `1` — the importer checks exact versions for every input entity; bumping it would implicitly version every warehouse/customer/mine file). Retain v1 parsing for these two/three entities (v1 = unitless, interpreted as canonical).
- **CSV contract (locked):** `template_version,unit,from_id,to_id,distance`. Every row (including blank-stub template files) carries the same valid `unit` + `version`. Mixed-version or mixed-unit rows → `format`-class rejection.
- **JSON envelope (locked):** `{templateVersion: 2, entity, unit, rows}` — `unit` on the **envelope only**, never duplicated per row. **JSON is export-only** (import stays CSV-only: `ImportRequest.csvText` + Papa + `ImportDialog` accepts `.csv,text/csv`; a JSON importer is out of scope).
- **Export value = current display unit**, `unit` = that display unit (full precision → lossless). **Import** reads the file's `unit`, converts value → the model's **canonical** unit for storage/solve (canonical is authoritative). A file whose `unit` is neither the model's canonical nor a known convertible unit → `format`-class rejection.
- Touch: `services/templates.ts` (`DistanceTemplateRow` + `unit`, CSV/JSON writers, `DISTANCE_TEMPLATE_VERSION`), `services/import.ts` (`DISTANCES_COLUMNS`, header check, unit read+convert, v1/v2 branch), export/import routes, `openapi.yaml` (`ExportEnvelope`/entity rows) + regen, tests. Client download converts to display unit before writing the Blob (export already downloads client-side).

## Amendment table — earlier Chapter 4 decisions superseded/revised

| Prior | Was | Now |
|-------|-----|-----|
| D13 | bands derived, non-editable for Chen | editable, live lens (Part A) |
| D19 | overwrite `distanceBands=[high,max]` on every write | preserve supplied bands; derive only when omitted (Part A) |
| D8/D14 | canonical-unit (`km`) labels shown in the UI | unit-neutral + app-wide toggle (Part D) |
| D29 / 5b | (design draft) files canonical + labeled / unitless | versioned unit-labeled files, value in display unit, import converts to canonical (Part E) |
| solve.py Chen `bandCoverage` | cumulative, 2 fixed rows, authoritative | ignored for Chen; coverage computed from edges+bands, exclusive + overflow (1c/1d) |
| 1c top-pin (round-2 draft) | top band pinned to maxDistKm, prune-on-lower | free bands + overflow bucket, no maxDist coupling (deep-review #2) |

## Non-goals
- No `solve.py` change (math or reporting), no dataset change, no result-envelope shape change.
- No numeric conversion of stored `inputs` or solver I/O (always canonical). Exported **file** values ARE in the display unit (import converts back to canonical) — the only place display-unit numbers persist.
- No coupling of highService and avg-cap.
- No dynamic feasibility message replacing the 199M hint.
- No JSON import path; no global `TEMPLATE_VERSION` bump.

## Review Resolutions (comments 1–12)
1. Accepted — backend input-contract change (Part A); scope reframed (not frontend-only).
2. Resolved — live, exclusive coverage from edges+bands; backend `buildServiceStatsRows` + `ServiceStatsTab` recompute; solve.py untouched (1d, Part A).
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
7. Live coverage: editing the band-lens recolors current + historical stepped results and updates `ServiceStatsTab` without re-solve (exclusive + overflow, interval labels, percents sum to 100%); Chen Service-Stats client-side export matches; stepping history does not change the active lens; editing the lens doesn't mutate unrelated inputs.
8. 199M hint gone from both `OptimizationParametersTab` and `SolveDialog`; grep-guard on the phrase + both test-ids.
9. `useDisplayUnit`: `auto` no-op; `km`/`mi` convert at `1 mi=1.609344 km`; `toDisplay∘fromDisplay` round-trips.
10. Toggle persists across reload (localStorage).
11. Write path: typing `500` in `mi` while canonical is `km` stores `804.672`; toggling never mutates `localInputs`/dirty/payload; no drift on repeated toggles; partial entry stays editable; **uncommitted draft live-converts on toggle**; **distance editor gated until canonical unit resolves** (delayed-manifest Chen write).
12. Non-distance fields (demand, coverageFloorDemand, p, gap, time, jade monetary objective) unaffected by the toggle.
13. Objective contract — all six models under both display units: p-median-us/brazil demand-distance (convert), transport-coal flow-distance (convert), two-echelon-gold truckload-distance (convert), jade monetary (no convert), Chen coverage % (no convert) / min-distance demand-distance (convert).
14. Export/import: v2 versioned unit-labeled round-trip (export display unit → import converts to canonical → stored canonical); mismatched/unknown-unit file rejected (`format`); old v1 unitless still imports as canonical; global `TEMPLATE_VERSION` unchanged; blank-stub carries unit+version.
15. Solver/accuracy unaffected: `e2e_accuracy.py` 99/99 unmodified; solver pytest green; default Chen scenario still 66.0639%.

## Verification gate
`pnpm run typecheck && pnpm --filter studio test && pnpm --filter api-server test` + solver pytest + `e2e_accuracy.py` (unchanged — no Python touched). Real-browser `qa-sdet` Playwright per standing plan-QA rule: band edit + live recolor + top-pin + high-link sync, unit toggle full conversion + persistence + no-drift, 199M hint gone, export/import unit-label round-trip.

## Deep Re-review Resolutions (deep-review #1–#8)
1. **Live Service Stats export** — Chen Service-Stats CSV/JSON generated **client-side** from `displayedResult.edges` + live band-lens; sidesteps the stale-export gate (`scenarios.ts:505`); no API/`solve.py` change (Part A live coverage).
2. **Overflow under live bands** — top-pin dropped; free bands + existing JADE overflow bucket everywhere; test with a stored edge beyond a lowered lens (1c, Part A, test 4).
3. **Distance-file v2 defined** — entity-specific `DISTANCE_TEMPLATE_VERSION=2` (global `TEMPLATE_VERSION` untouched); locked CSV `template_version,unit,from_id,to_id,distance`; JSON `{templateVersion:2,entity,unit,rows}` export-only; import CSV-only; v1 back-compat (Part E).
4. **Objective mapping corrected** — six-model table; transport = flow-distance (converts), jade = monetary (no convert), gold = truckload-distance, p-median = demand-distance (Part D table).
5. **Exclusive interval labels** — `≤600 / 600–1200 / … / Overflow`; percents sum to 100% incl. overflow; via `presentationBands` + JADE overflow helpers; no backend Service-Stats version bump (Chen export client-side) (Part A, test 7).
6. **Stable band-lens** — dedicated lens state independent of history stepping (history nav replaces `localInputs`, so the lens can't just read it); editing the lens never mutates unrelated inputs (Part A band-lens, test 7).
7. **No fallback-unit write** — distance editors gated until canonical unit resolves; delayed-manifest test. Draft-on-toggle rule = live auto-convert (Part D write path, test 11).
8. **Band invariants** — reject `maxDistKm ≤ highServiceDistKm`; strictly ascending in the backend contract; high boundary conditionally linked (removable); `minItems:1`; removal blocked at last boundary; legacy `[high,max]` valid (Part A, tests 1/3/6).

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
