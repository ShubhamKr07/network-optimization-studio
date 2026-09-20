# Chapter 4 (Chen's Cosmetics) — Distance Bands, Service-Distance Params, and App-Wide Unit Handling

**Date:** 2026-09-19
**Status:** Design approved — six review rounds resolved (see the six Resolutions sections + verbatim appendices). Ready for implementation plan.
**Scope:** Multi-layer. Frontend (large), backend TS input/export/import contract, **a new pure shared package `lib/units`**, **two additive nullable DB columns (`solve_jobs.result`, `scenarios.result_run_id`)**, a **field-scoped `distanceBands` PATCH endpoint**, manifest, OpenAPI + codegen. **No `solve.py` math OR reporting change. No dataset change. `e2e_accuracy.py` untouched (hard rule #2).** The result-envelope *shape* is unchanged; stored `inputs` distances and solver I/O stay in each model's canonical unit. Both new columns are **nullable** (jsonb and int) → plain `drizzle-kit push`; hard rule #3's two-step NOT-NULL protocol does not apply.

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
| 1b | Band timing | **Live.** Editing bands instantly recolors the current + historical stepped results and recomputes Service Stats from `edges` + the live lens, no re-solve. Exports recompute from `edges` + the **saved** lens (a lens-only Save is non-staling and field-scoped, decision 1f). **Supersedes the solve-snapshot invariant for bands only.** |
| 1e | Historical export | **Solve history is persisted and run-addressed** (fourth-review #1). `solve_jobs` already stores one row per run; it gains a nullable `result` jsonb holding that run's full envelope. `GET /scenarios/:id/export` gains an optional `runId` (a `solve_jobs.id`, ownership- and scenario-scoped); omitted → latest persisted `scenario.result` (today's behavior). The client sends the displayed history entry's run id, so a historical export matches the displayed tab. The stale-gate applies to the **latest** path only — an explicitly addressed historical run is by definition a frozen past result, not stale. The stepper's *inputs* snapshot stays client-side; export needs only the run's **result** + the scenario's saved bands. |
| 1f | Band-lens Save | **Server field-scoped `distanceBands` PATCH** (fourth-review #6, contract in **Part G**). A bands-only edit writes **only** that field via an **atomic `jsonb_set`** — never a select-merge-write of the whole `inputs` blob (fifth-review #3: a read-modify-write would still race). Client side it is driven by an **independent saved-lens ref + lens-dirty flag** that history navigation never touches — `isBandsOnlyChange(savedInputsRef, localInputs)` cannot carry this, since history nav replaces both. When the lens **and** ordinary inputs are both dirty, Save takes the **normal whole-inputs path** with the payload built as an explicit **`{ ...localInputs, distanceBands: activeBandLens }`** merge (sixth-review #2 — the active lens wins; `localInputs` may hold a stepped history entry's stale bands); the field-scoped route is used only for a lens-only save. Non-staling. |
| 1g | Run-id lifecycle | **`scenarios.result_run_id`** (nullable int, fifth-review #1) records which `solve_jobs.id` produced the row's current `scenario.result`, written by `jobRunner` at the same moment it writes the result — deterministic, not a latest-succeeded-job heuristic (`/solve-history` returns the newest job of **any** status and cannot serve this). Exposed as `Scenario.resultRunId`; the stepper's seed entry takes its `runId` from it. A newly completed solve attaches `runId` from the polling job id **independently of timing** (timing is absent on reload). Pre-migration rows are `null` → that entry is explicitly **non-exportable** once historical (download disabled + labelled), never a wrong export. |
| 1c | Band ↔ maxDist | **Free bands + overflow bucket** (top-pin dropped — deep-review #2 proved "no overflow" false: a live/historical lens can sit below an already-solved edge). Bands are free (positive, unique, strictly ascending, ≥1); **no coupling to `maxDistKm`**. Any edge beyond the last band routes through the **existing JADE overflow bucket** (`assignBandOrOverflow` / `OVERFLOW_BAND` `band:-1`) on map, Service Stats, and export. One boundary is **conditionally linked to `highServiceDistKm`** (retargets while present; removable; once removed, high edits don't touch bands). |
| 1d | Coverage semantics | **Cumulative + overflow** (reverses the round-2 "exclusive" draft — deep-review #3: the only overflow-aware helper `computeCumulativeBandCoverage` is cumulative, and the other 5 models' live Service Stats are cumulative; exclusive would need a new helper + make Chen inconsistent). Reuse `computeCumulativeBandCoverage` (already appends an `OVERFLOW_BAND` row); wire Chen into `presentationBands` like its siblings; remove the Chen live-recompute guard. Map coloring stays per-edge `assignBandOrOverflow`. Computed from `edges` + live bands, not `metrics.bandCoverage`. |
| 2 | High-service vs avg cap | **Independently editable, seeded to their existing defaults** (`highServiceDistKm=600`, `avgServiceDistCapKm=1000`). **No "same default" coupling** (that would change the default golden). No model/math change. |
| 3 | 199M hint | **Remove from both** `OptimizationParametersTab` and `SolveDialog`. No replacement. Server-side `coverage_floor_infeasible` precheck still guards feasibility. |
| 4 | Hardcoded units | **Remove app-wide** across reachable components. No shared component infers unit from `modelId`. `distanceUnit` stays internal (manifest + persisted + result). |
| 5 | Unit toggle | **Approved** (reverses the earlier "not approved" note — explicit user decision). **Full conversion, app-level, persisted** (`auto|km|mi`). |
| 5b | Export/import files | **Value in current display unit + explicit unit label; SERVER-owned conversion.** Export route gains a validated `unit=km\|mi` query param (default canonical when omitted); the server converts canonical rows and emits the final CSV/JSON tagged with `unit`. The client passes the current display unit. Import reads the file's `unit` and converts to the model's **canonical** unit for storage/solve (storage/solver always canonical). Applies to **every distance-bearing entity — input AND output**: `distances`/`legDistances`/`laneCosts` (importable) + `assignments`/`costSummary`/`serviceStats`/`flows` (output). Entity-specific `DISTANCE_TEMPLATE_VERSION = 2` (global `TEMPLATE_VERSION` stays 1). Backend + OpenAPI contract change. |
| 6 | Objective units | **One pure mapping in a new shared workspace package `lib/units`** (fourth-review #3) — the API server cannot import a React-context formatter from `artifacts/studio`, so the single-contract claim only holds if the mapping is cross-runtime. `lib/units` is pure TS (zero React): conversion math, the six-model objective-dimension mapping, and the cumulative+overflow coverage helper. Studio wraps it with `UnitApi`/presentation (`lib/objectiveFormat.ts` becomes a thin wrapper); **api-server calls the same pure functions** for export. `modelId`/mode are referenced only inside that package. Shared contract tests: every model × mode × both units. |
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
- **Every band-bearing export** recomputes `band` server-side from the **saved** lens (fourth-review #5, decision 1c). Today `assignments`/`flows` write `band: e.band ?? null` (`templates.ts:1219,1410`), i.e. the **solver's solve-time** band — and **`solve_chens` writes no `band` at all** (`solve.py:1273` emits only `{fromId,toId,distance,flow}`), so Chen's band column is blank today. Recomputing gives "band" **one meaning everywhere** (map, tab, exports) and fills Chen's blank column. Because this changes band semantics, `assignments` and `flows` schemas are **version-bumped** alongside `serviceStats`. Routed through the server-owned `unit=` route (decision 5b); the `OVERFLOW_BAND = -1` sentinel is **never unit-converted**. `solve.py` untouched (its Chen `metrics.bandCoverage` becomes unused).
  - **Row source is per-model and preserved (fifth-review #5).** The recompute applies one shared distance→band function (`assignBandOrOverflow`, exported from `lib/units`) to **each row's own distance**, whatever builder produced that row. It does **not** re-derive rows from `result.edges`. Generic single-echelon assignments keep their serving edges; **JADE assignments keep `result.details.assignments`** (product-level rows, `templates.ts:1463-1509`); gold keeps its existing builder; flows keep theirs.
  - **Band representation is locked per schema:** generic rows stay **numeric index + `-1` sentinel** (`AssignmentTemplateRow.band: number | null` → `number`); **JADE keeps its display-label string** (`"Band 2"` / `"Overflow"`, its existing on-screen contract). Both are produced from the *same* shared function — only the rendering differs. Per-model assignment/flow export fixtures.
  - **Scope applies per manifest, not uniformly (fifth-review #2).** Band-bearing entities per model, read from `capabilities.outputGrids`: Chen / p-median-us / p-median-brazil → `assignments` + `serviceStats` (**no `flows`** — absent from their manifests); transport-coal → `flows` + `serviceStats` (**no `assignments`**); two-echelon-gold-au + two-echelon-jade-us → `assignments` + `flows` + `serviceStats`. "All six models" means each model's own supported band-bearing set.
  - *Flagged, out of scope:* gold's generic `buildAssignmentRows` maps **all** edges with no leg filter, so its assignments export currently includes `mine_to_refinery` rows. **Pre-existing defect**, not introduced here; this bundle changes only the `band` value, never a row source.
- **Export vs tab timing:** the on-screen tab is live (pre-Save); a file reflects the **saved** lens. A lens-only Save is field-scoped + non-staling (decision 1f), so "edit bands → Save → export" is a two-click, side-effect-free path.

**Server/frontend coverage parity (fourth-review #5).** Both runtimes call the **same pure helper** in `lib/units` (ported from `computeCumulativeBandCoverage`), so parity is structural rather than maintained by convention. The helper's contract, locked:
- two-echelon/JADE models use **outbound/customer-serving edges only** (matching `ServiceStatsTab`'s `isOutboundLeg` filter); single-echelon models use all service edges.
- cumulative percentages, identical rounding to today's `Math.round(flow*100/total)`.
- the overflow row is **omitted when zero** (matching the existing `if (overflowFlow > 0)` guard), retained otherwise.
- computed from **saved `inputs.distanceBands`**, never `metrics.bandCoverage`.
- `OVERFLOW_BAND = -1` is a sentinel, never a distance → never unit-converted.
Parity fixtures cover single- and two-echelon data, zero flow, boundary equality, overflow present/absent, and both requested units.

**Band-lens state + field-scoped Save (blockers #1/#6/#10, decisions 1b/1f).** A **dedicated band-lens state**, seeded from the active scenario's bands and edited by the band editor, drives all displayed-result coloring/coverage (current, unsaved-draft, historical-stepped). **History stepping does NOT overwrite the lens** (result-history nav replaces `localInputs`/`savedInputsRef`, `Workspace.tsx:1454-1469`). Persisting a lens edit uses the **server field-scoped `distanceBands` PATCH** (decision 1f) — the client never sends a whole-`inputs` blob for a bands-only edit, so a bands edit while browsing a `p=3` history entry **cannot** overwrite the latest `p=5` (deep-review #1, confirmed against `handleSaveInputs` `Workspace.tsx:1703+`, which PATCHes the entire `localInputs`), and the React-Query-cache staleness window (fourth-review #6) is closed by construction rather than narrowed. **The lens has its own saved reference and dirty flag (fifth-review #3)** — `isBandsOnlyChange(savedInputsRef, localInputs)` cannot drive this, because history navigation replaces *both* of those. The field-scoped save sends the **lens state directly**, not a diff of `localInputs`.

**Both-dirty payload is an explicit merge (sixth-review #2).** When the lens *and* ordinary inputs are both dirty, Save takes the normal whole-inputs path — but the payload is constructed as **`{ ...localInputs, distanceBands: activeBandLens }`** immediately before validation and PATCH. Saying the whole-inputs path "already carries bands" was **not** guaranteed by the state contract: after *edit lens → step history*, `localInputs` holds the stepped entry's bands while the live lens lives only in the independent lens state, so a subsequent ordinary edit + Save would have persisted the stale history bands and silently dropped the lens edit. **The active lens always wins** over whatever band array happens to sit in `localInputs`. This supersedes the solve-snapshot read **for bands only**; the underlying result is untouched. Tested in **both orders** — step history → edit bands → Save, **and** edit bands → step history → Save — each asserting every latest non-band value preserved, scenario non-stale, and a PATCH body containing **only** `distanceBands`; plus stepping history never changing the active lens, and the both-dirty case taking the whole-inputs path.

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

**Write path + draft contract (blocker #11, fourth-review #2, fifth-review #6 — this is the single normative statement; no appendix overrides it).** Every distance input holds a raw-string draft. **A draft's text is always in the current effective display unit** — there is no per-field unit divergence and no `authoredUnit` field, because the toggle rule below makes a mismatch unrepresentable.

- **Completeness grammar (exact):** a draft is *complete* iff `text` matches `/^-?(\d+(\.\d+)?|\.\d+)([eE][+-]?\d+)?$/`. So `5`, `-5.5`, `.5`, `5e3`, `5e-3` are **complete**; `""`, `-`, `.`, `5.`, `5e`, `5e+`, `--5` are **incomplete**. Numeric parseability is *not* the test — `parseFloat("5.")` returns `5`, yet `5.` is an editable partial token.
- **On unit toggle:** *complete* → convert `text` old→new effective unit in place (e.g. `500` under km becomes `310.6856` under mi, still an uncommitted draft). *Incomplete* → **discard the draft**; the field reverts to its stored value rendered in the new unit. Discarding is **visible** (the field visibly snaps back), never silent.
  - *Why discard rather than retain (fifth-review #6):* retaining an incomplete draft across a toggle lets a field display `5.5` under an `mi` label while committing `5.5` **km**. Discarding removes that class entirely — no number mutates under the cursor mid-typing, the global toggle is never blocked, and the contract collapses to "a draft is always in the unit you can see." Consistent with the Esc/scenario-switch discard rule below. Cost: a half-typed value is lost, visibly, in the rare case where the user toggles the global unit mid-token.
- **On commit (blur/Enter):** parse `text`, convert from the **current effective unit** → canonical, write `localInputs`, clear the draft. An incomplete draft at commit time is discarded (field reverts to the stored value).
- **Cancel/Esc** discards the draft; **scenario switch** discards all drafts.
- Toggling units never mutates `localInputs`, never marks dirty, never changes a save/solve payload; repeated toggles introduce no drift (storage is never re-quantized by a toggle); presentation rounding is never written back unless the user commits.

**No fallback unit — writes OR reads (blocker #7, fourth-review #4).** Several components fall back to `mi` while the manifest loads (e.g. `ServiceStatsTab.tsx:27-31`). Normatively:
- **Writes:** distance editors are **gated/disabled until the canonical `"km"|"mi"` is resolved** (or the resolved canonical is threaded as a required value from an authoritative parent).
- **Reads:** **no distance value and no unit label renders at all** until the canonical unit is authoritative — from the manifest, or already carried by the result/envelope. Until then the cell shows a loading placeholder. A Chen km value must never transiently render under an `mi` label.
- Delayed-manifest tests cover **both** a Chen write and a Chen read.

**Write-path inventory (blocker #7) — every surface owned + tested:** `OptimizationParametersTab` (high/max/avg-cap/band inputs), `SolveDialog` (its separate avg-cap/band inputs), `DistancesTab` (reference display + existing-row edit + add-row), `LegDistancesTab` (edit + add), `LaneCostsTab` (transport-coal — its `cost` values are distances, convert), `JadeDistancesTab` (separate component + write path), map popups/tooltips + legends, all output grids/KPIs, Landing recent-solves, validation strings. **`Studio.tsx` excluded (dead code).**

**Toggle UI:** compact `auto/km/mi` control in the app header (model screens + Landing).

**What converts (blocker #4/#8).** All **distance-dimension** values convert. **`transport-coal`'s `laneCostOverrides.cost` ARE distances in miles** (`transportLp.ts:18-25`: named `cost` for model vocabulary only; the objective is literally distance×flow) — they **convert** and participate in the unit design. Never convert: demand, `coverageFloorDemand`, `p`, gap, time-limit, and genuinely **monetary** values (`two-echelon-jade-us` only — its objective applies $/ton-mile rates + minimum charges, `solve.py:991-1010`).

### Objective units (blocker #8, decision 6, fifth-review #4) — six-model contract
**`@workspace/units` is the single authority.** It owns the typed `(modelId, objectiveMode) → dimension` mapping **and** the numeric conversion, as pure functions with no React dependency, so `artifacts/api-server` calls exactly the same code the frontend does (a React-context formatter cannot cross the package boundary — that was the contradiction fifth-review #4 caught). `artifacts/studio/src/lib/objectiveFormat.ts` is **only a presentation wrapper** over that pure contract: it adds `UnitApi`/locale formatting and the suffix string, and holds no mapping of its own. `modelId`/mode are referenced only inside `@workspace/units`. Consumers (`formatObjective`/`formatChenObjective`, Landing, `ObjectiveBar`, CostSummary, compare) route through the wrapper; the export builders route through the pure functions directly.

**`@workspace/units` public surface (locked):** unit conversion (`toDisplay`/`fromDisplay`/`effectiveUnit`), the objective-dimension mapping + numeric objective conversion, the cumulative+overflow **coverage** helper, **and per-edge `assignBandOrOverflow` / `OVERFLOW_BAND`** — the last is required because assignment and flow exports need a *distance → band index* function per row, which a cumulative-coverage helper cannot produce (fifth-review #4). Studio re-exports the same `assignBandOrOverflow` rather than keeping a second copy, so map colors, grid labels, and server export cannot drift.

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

**`unit=` applies to every invocation (fourth-review #7).** `downloadEntityExport` is shared by all 15 entities, so it appends `unit=` **universally** rather than maintaining a client-side distance-entity allowlist — that allowlist is precisely this repo's most-recurring bug class (a per-entity gate updated for one entity, forgotten for a sibling). Server behavior, locked and deterministic: the value is **always validated** (`km`|`mi`; anything else → `400 {error}` for **any** entity, distance-bearing or not), and is **ignored** for non-distance entities (`warehouses`, `customers`, `mines`, `stations`, `refineries`, `plants`, `plantCapabilities`, `openWarehouses`), whose output is byte-identical with or without it.

**Precision / round-trip (deep-review #9).** Exported distances serialized at **4 decimal places**. Round-trip (export display → import → canonical) tolerance: **abs ≤ 0.001 canonical / rel ≤ 1e-5**. No "lossless" claim; tests run repeated export→import cycles against this tolerance.

**Importable input entities — `distances`, `legDistances`, `laneCosts`:**
- **Entity-specific version:** `DISTANCE_TEMPLATE_VERSION = 2`, used **only** for these entities. **Do NOT touch the global `TEMPLATE_VERSION`** (`templates.ts:15-23`, stays `1`). Retain v1 parsing (v1 = unitless, canonical).
- **CSV header (locked), per-entity value column:** `distances`/`legDistances` → `template_version,unit,from_id,to_id,distance`; **`laneCosts` keeps its `cost` column** → `template_version,unit,from_id,to_id,cost` (chapter vocabulary preserved). The serializer/parser take the value-column name per entity. Every row (incl. blank stubs) carries the same valid `unit`+`version`; mixed-version/mixed-unit rows → `format`-class rejection.
- **JSON envelope (locked):** `{templateVersion: 2, entity, unit, rows}` — `unit` on the **envelope only**, never per row. Use distinct internal-canonical / CSV-row / JSON-envelope types (or pass `unit` as a serializer arg) so the row object never carries a duplicated `unit`. **JSON is export-only** (import stays CSV-only: `ImportRequest.csvText` + Papa + `ImportDialog` `.csv,text/csv`; JSON import out of scope).
- **Import unit rule (locked):** read the file's `unit`; a **different-but-known** unit (e.g. a `mi` file into a km-canonical model) is **accepted and converted** to canonical; **mixed** units/versions within one file → `format`; **unknown** unit → `format`.
- Touch: `services/templates.ts` (per-entity row/CSV/JSON writers incl. `LaneCostTemplateRow`/`LaneCostStubRow`/`laneCostRowsToCsv`/`LANE_COST_COLUMNS` + `DISTANCE_TEMPLATE_VERSION`), `services/import.ts` (`DISTANCES_COLUMNS`/`LANE_COST_COLUMNS`, header checks, unit read+convert, v1/v2 branches), export/import routes (`unit=` param), `openapi.yaml` + regen, tests.

**Output entities — `assignments`, `costSummary`, `serviceStats`, `flows` (deep-review #6):** these carry distance-dimension values and **also convert** under `unit=`.
- Rename hardcoded unit-specific columns to neutral + a `unit` column: `flows` `distance_mi`/`distanceMi` → `distance` (+ `unit`) (`templates.ts:1386-1418`); `costSummary` `weightedAvgDistance` carries `unit`; the objective value converts via the **shared `lib/units` objective mapping** (decision 6 / Part D table) — distance/demand-distance/flow-distance/truckload-distance convert, jade monetary + Chen coverage-% do not. The API server calls the **same pure function** Studio does; there is no second mapping.
- `serviceStats` band boundaries + `distance_unit` follow the `unit=` param; rows are **cumulative + overflow** (decision 1d), computed by the shared helper — the same rows the tab shows.
- `assignments` and `flows` **recompute `band` by applying `assignBandOrOverflow` to each builder row's own distance**, using the saved lens — **each entity/model keeps its existing authoritative row source** (generic → serving edges; **JADE assignments → `details.assignments`** product-level; gold → its builder; flows → theirs). This replaces today's solver-emitted `e.band ?? null`. *(Corrects sixth-review #4: the earlier "recompute from `edges`" phrasing here contradicted Part A's per-model rule — Part A is normative, this line now matches it.)* Rendering is schema-specific per the band-representation lock; `OVERFLOW_BAND` is never unit-converted in any schema. Scope follows the per-manifest band-bearing entity matrix in Part A, not a uniform entity set.
- Version output schemas (`OUTPUT_TEMPLATE_VERSION` bump — band semantics change for `assignments`/`flows` in addition to the column/unit changes); OpenAPI `ExportEnvelope`/entity-row shapes + regen; tests per entity under both units.

**Specialized JADE output serializers must become self-describing (sixth-review #3).** Today the JADE serializers **drop** the version/unit their row objects carry: `jadeAssignmentRowsToCsv` emits only `product,customer,assigned_warehouse,distance,distance_band` (`templates.ts:1512-1517`) despite `JadeAssignmentTemplateRow` holding `templateVersion` + `distanceUnit`, and `jadeFlowRowsToCsv` emits only `leg,from_id,to_id,distance,distance_band,flows` (`templates.ts:1526-1576`) while `JadeFlowTemplateRow` has **no `distanceUnit` field at all**. A version constant that exists only on an intermediate TS object the serializer discards does not satisfy decision 5b. Locked v2 contracts:

| Artifact | v2 CSV header | v2 JSON |
|---|---|---|
| generic `assignments` | `template_version,customer_id,warehouse_id,distance,distance_unit,band,flow` | `{templateVersion:2, entity:"assignments", unit, rows:[…]}` |
| generic `flows` | `template_version,from_id,to_id,distance,distance_unit,band,flow` (`distance_mi` removed) | `{templateVersion:2, entity:"flows", unit, rows:[…]}` |
| **JADE `assignments`** | `template_version,product,customer,assigned_warehouse,distance,distance_unit,distance_band` | `{templateVersion:2, entity:"assignments", unit, rows:[…]}` |
| **JADE `flows`** | `template_version,leg,from_id,to_id,distance,distance_unit,distance_band,flows` | `{templateVersion:2, entity:"flows", unit, rows:[…]}` |
| `serviceStats` | `template_version,band,distance_unit,percent` (band `-1` ⇒ overflow row) | `{templateVersion:2, entity:"serviceStats", unit, rows:[…]}` |

- **`JadeFlowTemplateRow` gains `distanceUnit`** (it has none today). Column-carried version+unit is chosen over a wrapper envelope for CSV because the generic assignment CSV already carries `template_version` + `distance_unit` as columns — one convention across every exported CSV, rather than two.
- `distance_band` keeps JADE's display-label string; generic `band` keeps the numeric index + `-1`.
- **Fixtures locked for CSV *and* JSON, at `unit=km` and `unit=mi`, for generic and JADE assignments and flows** — including JADE flows, whose current shape carries neither field.

## Part F — Persisted solve history + run-addressed export (decision 1e, fourth-review #1)

The Workspace can display a historical result held only in client `useState` (`resultHistoryState`, `Workspace.tsx:1432`; `displayedResult` at `1544-1547`), while `GET /scenarios/:id/export` receives just a scenario id and reads the latest persisted `scenario.result` (`routes/scenarios.ts:539-566`) — so a server-owned export could not match a displayed historical tab. Resolved by addressing runs, not scenarios:

- **Storage:** `solve_jobs` already persists one row per run (user- and scenario-scoped, with `inputsHash`). It gains a **nullable `result` jsonb** column holding that run's full envelope, written by `jobRunner.ts` alongside the existing `resultSummary`. Chosen over joining `result_cache` by `inputsHash` (zero new storage) because `result_cache`'s stated contract is a **cache** — adding eviction/TTL later would silently break historical export. History must be durable by construction.
- **Addressing:** the export route gains an optional **`runId`** (a `solve_jobs.id`). It must belong to the authenticated user **and** the addressed scenario — otherwise **404**, never 403 (hard rule #5). Omitted → today's behavior (latest `scenario.result`).
- **Staleness:** the stale-gate (`routes/scenarios.ts:562`) applies to the **latest** path only. An explicitly addressed run is a frozen past result by definition, so it is exportable even when the scenario is stale.
- **Client:** `downloadEntityExport` gains an optional `runId`; the Workspace passes the displayed history entry's run id (and omits it when viewing the latest). Export therefore matches the displayed tab **for every addressable entry** — i.e. every entry carrying a `runId`. Entries without one (legacy, pre-migration) are explicitly non-exportable rather than silently exporting the latest; see the run-id lifecycle below.
- **Bands:** the run supplies the **result/edges**; the **lens** is always the scenario's currently-saved `distanceBands` (not the run's snapshot) — consistent with the live-lens model. The stepper's inputs snapshot stays client-side and is not persisted.
- **Migration:** the new column is nullable, so pre-existing `solve_jobs` rows have `result = null`; a `runId` addressing such a row returns **422** (`"That solve's full result was not retained"`) rather than a wrong export. No backfill.

### Run-id lifecycle (fifth-review #1, decision 1g)
`ResultHistoryEntry` is `{result, inputs, timing?}` with **no run id**, and the stepper's seed entry is built straight from `currentScenario.result/.inputs` (`Workspace.tsx:1264-1274`, `1455-1458`). `/solve-history` cannot supply it — it returns the newest job of **any status** per scenario (`solveHistory.ts:11`), which may be a later *failed* job. Closed end-to-end:

- **Source of truth:** new nullable `scenarios.result_run_id` (int) holding the producing `solve_jobs.id` — deterministic, not a latest-succeeded lookup (which breaks for clones and for a later failed solve).

### Referential + transactional integrity (sixth-review #5)
- **It is a real FK with `ON DELETE SET NULL`.** A *restrictive* FK would deadlock the existing delete order — `routes/scenarios.ts:258-278` deletes the `solve_jobs` children **first** (there is no cascade on `solve_jobs.scenario_id`), which a restrictive back-pointer would block. `SET NULL` makes that same order work unchanged: deleting the jobs nulls the pointer, then the scenario row deletes. It also lands exactly on the already-locked legacy semantics — a `null` `resultRunId` is simply a non-exportable historical entry.
- **One transaction for success.** `markSucceeded` today issues **two independent `db.update` statements** (`jobRunner.ts:293-310`), so a partial failure can leave a succeeded, addressable run whose scenario still points at an older result — or a scenario result with no run pointer. "Written at the same moment" is not atomicity. Normatively: `solve_jobs.status/result/resultSummary/finishedAt` **and** `scenarios.result/resultRunId/solvedAt/updatedAt` are written in a **single `db.transaction`**, on both the normal solver path and the cache-hit path (one call site, `jobRunner.ts:283,322`). A committed `scenario.result` and `scenario.resultRunId` therefore always identify the same committed job result.
- **Scenario deleted while a worker completes:** both updates are id-scoped inside that one transaction; if the scenario (and its jobs) were deleted mid-solve, each statement matches **0 rows** and the transaction commits as a no-op. No error, no orphan, no resurrected row.
- **Tests:** schema/migration (nullable + FK action present); scenario delete with a solved scenario still 204 → 404 with the new FK in place (delete order unchanged); successful solve commits both sides; cache-hit path commits both sides; a forced mid-transaction failure leaves **neither** side written; delete-during-solve → no-op.
- **API:** `Scenario` gains read-only `resultRunId: number | null` (OpenAPI + regen).
- **Seed:** `ResultHistoryEntry` gains `runId?: number`; the seed entry takes `currentScenario.resultRunId`.
- **New solves:** `runId` is attached at append time from the **polling job id**, independently of whether `timing` exists (timing is session-local and absent after reload — it must not gate `runId`).
- **Legacy / unaddressable:** `resultRunId === null` (pre-migration solve) → that entry is explicitly **non-exportable** once it is no longer the latest: the download action is disabled and labelled ("this solve's result wasn't retained"). Never a silently-wrong export.
- **Background refetch / another tab or device:** a changed `scenario.result` reseeds the stepper and carries the new `resultRunId` with it; solves performed elsewhere have their own `solve_jobs` rows, so they remain addressable by id.
- **Acceptance test (exact, per fifth-review #1):** load an already-solved scenario → run another solve → step back to the **seeded** entry → export. With a non-null `resultRunId` the file matches that entry; with a legacy `null` the UI shows the entry as non-exportable. The universal "every history position" claim is replaced by this two-branch contract.

### Boundary validation (fifth-review #7)
- `runId` must be a **finite positive integer**; malformed, fractional, zero, or negative → **400**.
- A non-null `solve_jobs.result` is parsed through **`ResultEnvelopeSchema.safeParse`** before any serialization — jsonb is trusted no more broadly than the existing latest-result path trusts `scenario.result`.
- A malformed stored envelope → **422**, never a throw and never invalid output.
- `markSucceeded` writes `result` and `resultSummary` **together**; it is the single call site for both the normal solver path and the cache-hit path (`jobRunner.ts:283,322`), so consistency is structural.
- **Tests:** step to an older result → export → matches the displayed tab; cross-user and cross-scenario `runId` → 404; stale scenario + explicit `runId` → 200; legacy null-result row → 422; malformed stored envelope → 422; `runId` = `0` / `-1` / `1.5` / `"abc"` → 400; omitted `runId` → unchanged latest-result behavior.

## Part G — Field-scoped `distanceBands` PATCH (decision 1f, fifth-review #3)

A lens-only save must be atomic at the **database**, not merely field-scoped at the API — an endpoint that selects `inputs`, merges bands in memory, and writes the whole blob back still has a read-modify-write race and would not deliver decision 1f's cross-tab/cross-device guarantee.

- **Route:** `PATCH /scenarios/:scenarioId/distance-bands`. Request `{ "distanceBands": number[] }`; response the updated `Scenario` (same shape as the existing scenario PATCH).
- **Ownership:** scoped by authenticated `user_id`; a non-owned or missing scenario returns **404**, never 403 (hard rule #5).
- **Validation:** per-model, delegated to the existing registry/validator so each model keeps its own rules — Chen's `≥1`, strictly ascending, unique, positive; JADE's own cardinality/integer rules unchanged. Invalid or missing body → **400**. Validation happens before any write.
- **Atomicity:** a single `UPDATE ... SET inputs = jsonb_set(inputs, '{distanceBands}', $1::jsonb)` — no read-modify-write, so no concurrent update to any other key in `inputs` can be lost. (A row-locked transaction is an acceptable equivalent if `jsonb_set` proves awkward for the array cast; the normative requirement is "cannot overwrite unrelated fields".)
- **Staleness:** does **not** bump `inputsUpdatedAt` — a bands-only change is non-geometric, matching the backend's existing bands-only stale-skip. The returned `Scenario.stale` therefore does not flip.
- **Tests:** only `distanceBands` changes (assert every other `inputs` key byte-identical after a concurrent write to one of them); 404 for non-owned and missing; 400 for invalid/missing body and for a model-invalid band array; `stale` unchanged; returned Scenario reflects the new bands.

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
| Decision 6 (round-3 draft) | single `lib/objectiveFormat.ts` in `artifacts/studio` | pure mapping in shared `lib/units`, consumed by BOTH studio and api-server (fourth-review #3) |
| Round-3 "merge onto latest cached inputs" | client merges `distanceBands` onto `currentScenario.inputs`, PATCHes whole blob | **server field-scoped `distanceBands` PATCH** (fourth-review #6, decision 1f) |
| Round-3 "export = same rows as the tab" | implied for historical results too | export is **run-addressed** via persisted `solve_jobs.result` + `runId` (fourth-review #1, decision 1e / Part F) |
| `assignments`/`flows` `band` | solver-emitted at solve time (blank for Chen) | recomputed from saved lens by the shared helper, **applied to each model's existing row source**; schemas version-bumped (fourth-review #5, fifth-review #5) |
| Round-4 "single `lib/objectiveFormat.ts` contract" (normative text) | Studio module is the contract | `@workspace/units` owns mapping + conversion; `objectiveFormat.ts` is a presentation wrapper (fifth-review #4) |
| Round-4 draft rule `{text, authoredUnit}` | incomplete draft retained verbatim across a toggle | incomplete draft **discarded** on toggle; `authoredUnit` removed — a draft is always in the visible unit (fifth-review #6) |
| Round-4 "export matches the tab in every history position" | universal claim | two-branch contract: addressable via `scenarios.result_run_id`, else explicitly non-exportable (fifth-review #1, decision 1g) |

## Non-goals
- No `solve.py` change (math or reporting), no dataset change, no result-envelope shape change.
- No numeric conversion of stored `inputs` or solver I/O (always canonical). Exported **file** values ARE in the display unit (import converts back to canonical) — the only place display-unit numbers persist.
- No coupling of highService and avg-cap.
- No dynamic feasibility message replacing the 199M hint.
- No JSON import path; no global `TEMPLATE_VERSION` bump.
- Solve history persists the run's **result** only — the stepper's inputs snapshot stays client-side. No history UI beyond today's stepper, no backfill of pre-existing `solve_jobs` rows.
- No conflict-resolution UX on the normal whole-inputs save path (decision 1f removes the need for it on the bands path specifically; ETag preconditions were considered and rejected — Fourth Resolutions #6).

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
4. Overflow: a stored edge exceeding the last band lands in the overflow bucket across map + Service Stats + each model's band-bearing exports, not folded into the last band — including after lowering the live lens below an already-solved edge. **Cross-cutting invariant:** `OVERFLOW_BAND` is a **categorical sentinel**, never a distance, and is **never unit-converted** in any schema. **Rendering is schema-specific** (sixth-review #1): the literal `-1` assertion applies **only to generic numeric band schemas**; **JADE assignment/flow CSV+JSON assert the string `"Overflow"`**. A single value can't be both, so the two assertions are scoped, never combined.
4a. Boundary fixtures for **both** representations: a distance exactly equal to a boundary (classified into that band, not the next), and a distance above the last boundary (overflow) — asserted once as the shared numeric classification from `assignBandOrOverflow`, and once per schema's rendering (`-1` generic, `"Overflow"` JADE), so classification and rendering cannot be conflated again.
4b. Band recompute, **per-model supported entities only** (fifth-review #2 — `flows` is absent from Chen/p-median manifests, `assignments` absent from transport-coal): Chen/p-median-us/p-median-brazil → `assignments` band populated (Chen's was blank); transport-coal → `flows` band; gold + JADE → both. Every model's band reflects the **saved lens**, not the solve-time value; schema versions bumped. No test requests an entity a model's `outputGrids` doesn't declare.
4c. Row sources preserved (fifth-review #5): JADE assignment rows still come from `details.assignments` (product-level) with its **display-label** band string; generic rows keep numeric index + `-1`; both produced by the same shared `assignBandOrOverflow`. Per-model export fixtures.
4d. **Self-describing v2 artifacts (sixth-review #3):** every band-bearing CSV *and* JSON carries `template_version` + `distance_unit`/`unit` **in the emitted artifact**, not merely on an intermediate row object — asserted against the locked header table for generic assignments/flows **and JADE assignments/flows**, at `unit=km` and `unit=mi`. JADE flows specifically gains `distanceUnit` (absent today).
5. Add-band rejects `≤0` and duplicates; strictly-ascending preserved.
6. API preserves supplied valid bands (no overwrite); derives `[high,max]` only when omitted; rejects unordered/non-unique/empty and `maxDistKm ≤ highServiceDistKm` at the boundary; manifest `minItems:1` tests updated.
7. Live coverage: editing the band-lens recolors current + historical stepped results and updates `ServiceStatsTab` without re-solve (**cumulative + overflow**, `≤band` labels + `Overflow` row); stepping history does not change the active lens. Field-scoped Save, tested in **both orders** (step history → edit → Save, **and** edit → step history → Save): all latest non-band values preserved, scenario non-stale, PATCH body contains **only** `distanceBands`. Both-dirty (lens + ordinary inputs) takes the whole-inputs path. Export via `unit=` reflects saved bands.
7d. **Part G endpoint** — `PATCH /scenarios/:id/distance-bands`: only `distanceBands` changes (every other `inputs` key byte-identical after a concurrent write to one of them, proving the `jsonb_set` atomicity); 404 non-owned/missing; 400 invalid or missing body and model-invalid array; `stale` unchanged; returned Scenario reflects new bands.
7e. **Both-dirty lens merge (sixth-review #2)** — exact sequence: edit lens → step history → edit an ordinary input → Save. Assert the ordinary value **and the active lens** are both persisted (not the stepped entry's bands), every other latest non-band value preserved, the save took the **whole-inputs** route, and staleness follows the ordinary-input change.
7f. **Run-id integrity (sixth-review #5)** — successful solve and cache-hit each commit job + scenario in one transaction; a forced mid-transaction failure writes **neither**; deleting a solved scenario still 204→404 with the FK in place; a solve completing after its scenario was deleted is a 0-row no-op; `ON DELETE SET NULL` leaves `resultRunId` null (entry becomes non-exportable, never dangling).
7b. **Coverage parity fixtures** — the shared `lib/units` helper produces identical rows frontend and backend for: single-echelon, two-echelon (outbound-leg filter only), zero flow, an edge exactly equal to a boundary, overflow present, overflow absent (row omitted), under both `km` and `mi`.
7c. **Run-addressed export (Part F)** — step to an older result → export → file matches the displayed tab, not the latest; cross-user `runId` → 404; cross-scenario `runId` → 404; stale scenario + explicit `runId` → 200; legacy `result = null` job row → 422; omitted `runId` → unchanged latest-result behavior.
8. 199M hint gone from both `OptimizationParametersTab` and `SolveDialog`; grep-guard on the phrase + both test-ids.
9. `useDisplayUnit`: `auto` no-op; `km`/`mi` convert at `1 mi=1.609344 km`; `toDisplay∘fromDisplay` round-trips.
10. Toggle persists across reload (localStorage).
11. Write path + draft contract: typing `500` in `mi` while canonical is `km` stores `804.672`; toggling never mutates `localInputs`/dirty/payload; no drift on repeated toggles. **Draft grammar, each token explicitly:** `""`, `-`, `.`, `5.`, `5e`, `5e+` are incomplete; `5`, `-5.5`, `.5`, `5e3`, `5e-3` are complete. **On toggle:** complete → converted in place; incomplete → **discarded**, field visibly reverts to its stored value in the new unit. Incomplete draft at commit → discarded. Cancel/Esc and scenario-switch discard drafts.
11c. **Display/commit unit can never diverge** (fifth-review #6): run the exact partial-toggle-complete sequence (`5.` under km → toggle to mi → type `5`) and assert **both** the visible unit label **and** the resulting canonical value — the field must read the stored value under an `mi` label (draft discarded), never `5.5` committing as km.
11b. **No fallback unit, both directions** — delayed-manifest Chen **write** (editor gated/disabled until canonical resolves) AND delayed-manifest Chen **read** (neither the number nor its unit label renders under the `mi` fallback; placeholder until authoritative).
12. Non-distance fields (demand, coverageFloorDemand, p, gap, time, jade monetary objective) unaffected by the toggle.
13. Objective contract — the **shared `lib/units` mapping**, exercised from **both** runtimes (studio + api-server call the same pure function; a backend-only second mapping would fail this test): all six models under both display units — p-median-us/brazil demand-distance (convert), transport-coal flow-distance (convert), two-echelon-gold truckload-distance (convert), jade monetary (no convert), Chen coverage % (no convert) / min-distance demand-distance (convert).
14. Export/import: server `unit=` round-trip within tolerance (export display @4dp → import → canonical, abs ≤ 0.001 / rel ≤ 1e-5, repeated cycles); **different-but-known** unit (mi file → km model) accepted+converted; **mixed** units/versions rejected (`format`); **unknown** unit rejected (`format`); old v1 unitless imports as canonical; global `TEMPLATE_VERSION` unchanged; blank-stub carries unit+version; `laneCosts` v2 keeps its `cost` column; `unit=` omitted → canonical (default).
14b. **`unit=` is universal** — the client appends it on every entity; an invalid value → **400 for any entity** (distance-bearing or not); a valid value on a non-distance entity (`warehouses`/`customers`/`mines`/`stations`/`refineries`/`plants`/`plantCapabilities`/`openWarehouses`) yields **byte-identical** output to omitting it.
15. Output exports (`assignments`/`costSummary`/`serviceStats`/`flows`) convert under `unit=`: `flows` neutral `distance`+`unit` (no `distance_mi`), `costSummary` objective converts per the six-model contract (+ `weightedAvgDistance` unit), `serviceStats` cumulative+overflow rows under the requested unit; output schema versions bumped.
16. Solver/accuracy unaffected: `e2e_accuracy.py` 99/99 unmodified; solver pytest green; default Chen scenario still 66.0639%.

## Verification gate
`pnpm run typecheck && pnpm --filter studio test && pnpm --filter api-server test && pnpm --filter @workspace/units test` + solver pytest + `e2e_accuracy.py` (unchanged — no Python touched) + OpenAPI regen committed with its spec change + `pnpm --filter @workspace/db push` for the two additive nullable columns (`solve_jobs.result`, `scenarios.result_run_id`). Real-browser `qa-sdet` Playwright per standing plan-QA rule: band edit + live recolor + overflow + high-link sync + field-scoped lens Save while browsing history, **historical run-addressed export matching the displayed tab**, unit toggle full conversion + persistence + no-drift + draft-grammar tokens, 199M hint gone, `unit=` export round-trip (input + output entities).

## Deep Re-review Resolutions (deep-review #1–#8)
1. **Live Service Stats export** — *(revised twice: third re-review #1/#2 made it server-owned via `unit=`; fourth-review #1 made it **run-addressed** via persisted `solve_jobs.result` + `runId`, so a historical export matches the displayed tab — see Part F. Lens Save is field-scoped per decision 1f.)*
2. **Overflow under live bands** — top-pin dropped; free bands + existing JADE overflow bucket everywhere; test with a stored edge beyond a lowered lens (1c, Part A, test 4).
3. **Distance-file v2 defined** — entity-specific `DISTANCE_TEMPLATE_VERSION=2` (global `TEMPLATE_VERSION` untouched); locked CSV `template_version,unit,from_id,to_id,distance`; JSON `{templateVersion:2,entity,unit,rows}` export-only; import CSV-only; v1 back-compat (Part E).
4. **Objective mapping corrected** — six-model table; transport = flow-distance (converts), jade = monetary (no convert), gold = truckload-distance, p-median = demand-distance (Part D table).
5. **Coverage semantics** — *(revised by third re-review #3: **cumulative + overflow**, not exclusive; reuse `computeCumulativeBandCoverage`, cumulative labels `≤600 / ≤1200 / … / Overflow`; no new helper, no rounding-apportionment rule needed; consistent with the 5 sibling models — Part A/1d.)*
6. **Stable band-lens** — dedicated lens state independent of history stepping (history nav replaces `localInputs`, so the lens can't just read it); editing the lens never mutates unrelated inputs (Part A band-lens, test 7).
7. **No fallback-unit write** — *(extended by fourth-review #4 to **reads** as well; the draft grammar was further revised by fifth-review #6 — incomplete drafts are discarded on toggle and `authoredUnit` was removed. Both now normative in Part D, tests 11/11b/11c.)*
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

## Fourth Approval-Review Resolutions (fourth-review #1–#7)
1. **Historical export** (BLOCKER) — **persist history + run id**. `solve_jobs` gains a nullable `result` jsonb (its own per-run row already exists); the export route gains an optional ownership+scenario-scoped `runId`; the client sends the displayed entry's run id. Historical export now genuinely matches the displayed tab. Chosen over `result_cache` join (cache contract) and over client-owned export (byte-match drift). **Part F**, decision 1e, tests 7c.
2. **Draft contract** (BLOCKER) — contradiction removed by **deleting** the old "until it parses" sentence; Part D now carries the sole normative rule, including an exact completeness regex (`5.` is incomplete despite `parseFloat("5.") === 5`). *(The round-4 `{text, authoredUnit}` form was superseded by fifth-review #6: incomplete drafts are **discarded** on toggle and `authoredUnit` is gone — see Fifth Resolutions #6.)* **Part D**, tests 11/11c.
3. **Cross-runtime objective owner** (HIGH) — the mapping moves into a **new pure shared package `lib/units`** (conversion math + six-model objective dimensions + the coverage helper). Studio wraps it; api-server calls the same functions. Test 13 exercises it from both runtimes so a backend-only duplicate would fail. **Decision 6**, Part D/E.
4. **Read-path fallback** (HIGH) — folded into normative Part D: no distance value **and no unit label** renders until the canonical unit is authoritative; placeholder otherwise. New delayed-manifest **read** test. **Part D**, test 11b.
5. **Server coverage parity** (HIGH) — locked contract (outbound-leg filter for two-echelon, all edges single-echelon, identical rounding, zero-overflow row omitted, `OVERFLOW_BAND` never converted, saved bands not `metrics.bandCoverage`) implemented once in `lib/units` and called by both runtimes; parity fixtures in test 7b. **Band scope widened, not narrowed**: `assignments` and `flows` also recompute band from the saved lens (filling Chen's blank column, since `solve_chens` emits no band), with schema version bumps. **Part A/E**, tests 4/4b/7b.
6. **Band-Save atomicity** (MEDIUM) — **server field-scoped `distanceBands` PATCH** (decision 1f). Chosen on consistency: "editing the lens changes only bands" then holds with no exceptions and no new user-facing concepts, across tabs/devices/history positions. The overclaimed "authoritative latest" wording is gone. **Part A**, test 7.
7. **`unit=` on non-distance exports** (MEDIUM) — **appended universally**; server always validates the value (400 on unknown, any entity) and ignores it for non-distance entities (byte-identical output). Avoids a client-side entity allowlist — this repo's most-recurring bug class. **Part E**, test 14b.

## Fifth Approval-Review Resolutions (fifth-review #1–#7)
1. **Run-id lifecycle** (BLOCKER) — new nullable **`scenarios.result_run_id`** written by `jobRunner` in the same write as `scenario.result` (deterministic; `/solve-history` returns the newest job of *any* status and cannot serve this). `Scenario.resultRunId` exposed; `ResultHistoryEntry.runId` added; the seed takes it from the scenario, a new solve takes it from the polling job id **independently of timing**. Legacy `null` → that entry is explicitly **non-exportable** (disabled + labelled), never a wrong export. The universal "every history position" claim is replaced by that two-branch contract. **Part F run-id lifecycle**, decision 1g, tests 7c.
2. **Unsupported Chen export** (BLOCKER) — test 4b was wrong in both directions: Chen's manifest has **no `flows`**, transport-coal has **no `assignments`**. Replaced with a per-model band-bearing matrix read from `capabilities.outputGrids`; "all six models" now means each model's own supported set. **Part A**, test 4b.
3. **Field-scoped PATCH made executable** (HIGH) — new **Part G**: exact route, OpenAPI request/response, 404 ownership, per-model validation via the registry, **atomic `jsonb_set`** (a select-merge-write would still race), non-staling timestamps, 400 on invalid body. Client side gets an **independent saved-lens ref + dirty flag** (history nav replaces `savedInputsRef`/`localInputs`, so `isBandsOnlyChange` cannot carry it) and sends the lens state directly; both-dirty takes the whole-inputs path; tested in **both** edit/step orders. **Part G**, decision 1f, tests 7/7d.
4. **Objective contract contradiction** (HIGH) — normative subsection rewritten: `@workspace/units` owns the model/mode → dimension mapping **and** numeric conversion; `objectiveFormat.ts` is described **only** as a presentation wrapper. The package's locked surface now explicitly includes **per-edge `assignBandOrOverflow`** — a cumulative-coverage helper cannot produce a per-row band index — and Studio re-exports it so map/grid/export cannot drift. **Part D**.
5. **JADE/gold row sources** (HIGH) — the "recompute from `edges`" claim is deleted. Each model keeps its authoritative row source (JADE → `details.assignments` product-level; gold → its builder; generic → serving edges); the shared distance→band function is applied to **each row's own distance**. Band representation locked per schema: generic **numeric index + `-1`**, JADE **display-label string**. Gold's missing leg filter is flagged as a **pre-existing** defect, explicitly out of scope. **Part A**, tests 4c.
6. **Draft display/commit mismatch** (HIGH) — resolved by **discarding incomplete drafts on toggle** rather than retaining them; `authoredUnit` is removed entirely and a draft is, by construction, always in the visible unit. No number mutates under the cursor, the toggle is never blocked, and the mismatch class is unrepresentable. New test asserts both the visible label and the canonical value for the exact partial-toggle-complete sequence. **Part D**, tests 11/11c.
7. **Run-addressed export boundaries** (MEDIUM) — `runId` must be a finite positive integer (400 otherwise); stored `solve_jobs.result` goes through `ResultEnvelopeSchema.safeParse` → **422** on malformed, never a throw or invalid output; `markSucceeded` writes `result` + `resultSummary` together and is the single call site for both the solver and cache-hit paths. **Part F boundary validation**, tests 7c.

---

## Sixth Approval-Review Resolutions (sixth-review #1–#5)
1. **Overflow assertion contradiction** (BLOCKER) — required test 4 demanded numeric `-1` across *all three* export types while 4c locked JADE to `"Overflow"`; a value cannot be both. Split: the literal `-1` assertion is scoped to **generic numeric band schemas**, `"Overflow"` is asserted for **JADE assignment/flow CSV+JSON**, and the cross-cutting invariant (categorical sentinel, never unit-converted) is stated once above both. New boundary-equality and above-last fixtures assert the shared numeric classification separately from each schema's rendering. **Tests 4/4a.**
2. **Both-dirty save could drop the lens** (HIGH) — correct catch: after *edit lens → step history*, `localInputs` holds the stepped entry's bands while the live lens is in its own state, so "the whole-inputs path already carries bands" was false and an ordinary edit + Save would have persisted stale bands. Payload construction is now locked as an explicit **`{ ...localInputs, distanceBands: activeBandLens }`** merge immediately before validation/PATCH — the active lens always wins. **Part A**, test 7e (the exact four-step sequence).
3. **JADE serializers drop version/unit** (HIGH) — confirmed: `jadeAssignmentRowsToCsv` omits both despite the row carrying them, and `JadeFlowTemplateRow` has no `distanceUnit` at all. A constant living only on a discarded intermediate object does not satisfy decision 5b. Locked an explicit **v2 header/JSON table for generic *and* JADE assignments/flows**; `JadeFlowTemplateRow` gains `distanceUnit`; column-carried version+unit chosen over a wrapper envelope so every exported CSV follows the one convention the generic assignment CSV already uses. Fixtures for CSV **and** JSON at both units. **Part E**, test 4d.
4. **Part E contradicted Part A** (HIGH) — the leftover "recompute band from `edges`" line reintroduced the exact fifth-review defect Part A had just fixed. Replaced with the per-model rule (apply `assignBandOrOverflow` to each builder row's own distance, preserving JADE's `details.assignments` source) and a pointer to the per-manifest entity matrix. **Part E.**
5. **`result_run_id` integrity** (HIGH) — locked as a real **FK with `ON DELETE SET NULL`**: a restrictive FK would deadlock the existing delete-children-first order (`scenarios.ts:258-278`), while `SET NULL` leaves that order working and lands exactly on the already-locked legacy/non-exportable semantics. `markSucceeded`'s **two independent updates** (`jobRunner.ts:293-310`) become **one `db.transaction`** covering job and scenario on both the solver and cache-hit paths, so a committed result and its `resultRunId` always identify the same committed job. Scenario-deleted-mid-solve is a 0-row no-op. **Part F**, tests 7f.

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

---

## Appendix — Fourth approval-review comments (2026-09-20, verbatim; all resolved above)

**Review verdict:** Not approved yet. The main product decisions are sound, but the document still has two
blockers and several implementation-contract gaps. Its previous "Design approved" status was premature.

### 1. BLOCKER — historical Service Stats export cannot match the displayed result

Decision 1b says band edits affect current and historical stepped results and recompute Service Stats and
exports. Part E further says the exported Service Stats rows are the same computed rows the tab shows.
Those statements are not implementable through the proposed server-owned endpoint as currently defined.

The Workspace can display a historical result from client-only `resultHistoryState`
(`Workspace.tsx:1432+`, with `displayedResult` selected at `1544-1547`). In contrast,
`GET /scenarios/:scenarioId/export` receives only a scenario id and exports the latest persisted
`scenario.result` (`routes/scenarios.ts:539-566`). `downloadEntityExport` likewise sends only the scenario
id, entity, and format. The server has neither the selected history index nor the historical result.

Choose and document one contract:

- output export is latest-result-only; disable or clearly label download while viewing history;
- persist/address solve history and add a result/run identifier to the export endpoint; or
- permit client-owned export specifically for historical results.

Add an acceptance test that steps to an older result and verifies the chosen behavior. Until this is
resolved, the claim that server export contains the same rows as the displayed historical tab is false.

### 2. BLOCKER — the draft unit-toggle rule remains contradictory

Part D says an incomplete draft such as `5.` remains verbatim across a toggle "until it parses," and that
blur/Enter commits through `fromDisplay` using the effective display unit. Third-review resolution 7
instead says every draft retains its authored unit and an incomplete draft is preserved and committed under
that original unit. Those rules produce different canonical values after the user types `5.`, toggles the
unit, and blurs.

`5.` also demonstrates why numeric parsing is not a sufficient completeness test: JavaScript parses it as
the number 5 even though the design classifies it as an editable partial token.

Correction: make the normative Part D contract define:

- draft state containing at least `{ text, authoredUnit }`;
- the exact syntactically-complete number grammar, including decimal and exponent forms;
- what happens when an incomplete draft becomes complete after a unit toggle;
- commit, cancel, blur, Enter, and scenario-switch behavior.

Required test 11 must explicitly cover empty, `-`, `.`, `5.`, incomplete exponent, complete exponent, and a
draft that becomes valid only after the toggle. The resolution appendix alone cannot override contradictory
normative text.

### 3. HIGH — the "single objective contract" has no cross-runtime owner

Part D specifies a single `lib/objectiveFormat.ts` contract using frontend `UnitApi`. Part E then requires
the API server to convert Cost Summary objective values using the same six-model mapping. The API server is
a separate package and cannot consume a React-context formatter from `artifacts/studio`.

Implementing a second mapping in the API server would contradict the claimed single contract and creates
an obvious drift risk for monetary, percent, demand-distance, flow-distance, and truckload-distance modes.

Correction: place a pure objective-dimension and numeric-conversion mapping in a shared workspace package
usable by both Studio and API server. The frontend may wrap it with presentation formatting and `UnitApi`;
the backend must call the same pure mapping for export. Lock the module/package path and add shared contract
tests for every model/mode.

### 4. HIGH — read-path fallback prevention is claimed but not specified or tested

The normative Part D section gates only distance writes while canonical metadata is loading. Third-review
resolution 8 says reads are also gated with a loading placeholder, but that requirement was not folded into
the read-path section. Required test 11 mentions only the delayed-manifest editor/write case.

Correction: state normatively that no distance value or unit label renders until canonical unit metadata is
authoritative, unless an authoritative unit is already carried by the result. Add a delayed-manifest Chen
read test proving neither the number nor its label is transiently rendered using the existing `mi` fallback.

### 5. HIGH — server Service Stats parity is underdefined

The existing backend `buildServiceStatsRows` reads frozen `result.metrics.bandCoverage`. The revised design
requires server-side recomputation from result edges and persisted bands, but it does not define a backend
equivalent of the frontend computation or how parity is maintained across packages.

The server contract must explicitly lock:

- two-echelon models use only outbound/customer-serving edges, matching `ServiceStatsTab`;
- single-echelon models use all service edges;
- percentage rounding matches `computeCumulativeBandCoverage`;
- zero-overflow rows are either omitted or retained consistently;
- the `OVERFLOW_BAND = -1` sentinel is never distance-converted;
- saved bands, rather than `metrics.bandCoverage`, are used for the recomputation.

Prefer a shared pure coverage helper. Otherwise add frontend/backend parity fixtures covering single- and
two-echelon data, zero flow, boundary equality, overflow, and both requested units.

Also clarify whether "overflow in export" means the Service Stats export only. Assignment exports already
contain a `band` field, while Chen solver edges carry no stored band. If Assignment export must reflect the
saved live lens, require that recomputation explicitly; otherwise narrow decision 1c and required test 4 to
Service Stats export.

### 6. MEDIUM — the band-only Save is not actually atomic

Part A calls `currentScenario.inputs` the authoritative latest server inputs. It is client-cached state and
can be stale relative to a concurrent server update. Merging `distanceBands` into that object and sending a
complete inputs payload can still overwrite another update between fetch and PATCH.

Correction: prefer a server-side field-scoped `distanceBands` PATCH, or require a version/ETag precondition
with conflict handling. If concurrent editing is explicitly outside scope, say so and weaken the
"authoritative latest"/atomicity claim. Retain the existing history-step regression test in either case.

### 7. MEDIUM — `unit=` behavior for non-distance exports is unspecified

`downloadEntityExport` is shared by distance-bearing and non-distance entities. Part E says the client
appends the current display unit, but does not say whether that applies to every invocation or only to the
distance-bearing entity set.

Lock one behavior and test it:

- append `unit=` only for `distances`, `legDistances`, `laneCosts`, `assignments`, `costSummary`,
  `serviceStats`, and `flows`; or
- append it universally, with the server validating but otherwise ignoring it for non-distance entities.

Also specify the response for an invalid unit on a non-distance export so direct API behavior is
deterministic.

### Validated as sound in this review

- Free, strictly ascending Chen bands with an explicit overflow bucket.
- Cumulative coverage aligned with `computeCumulativeBandCoverage`.
- Independent high-service and average-cap values without changing the golden model.
- Removal of both hardcoded 199M hints.
- Server-owned export conversion and canonical storage.
- Versioned distance-input files, retained `laneCosts.cost`, and v1 compatibility.
- Correct objective dimensions for all six models.
- Output schema versioning and an explicit numerical round-trip tolerance.

### Fourth approval-review verification performed

Reviewed the authoritative `chen-bands-units` branch at commit `3c085c3` against the current Workspace
history state, generic download client, server export route, output template builders, Service Stats helper
semantics, all six objective implementations, manifests, and the third-round resolution claims. Ran
`git diff --check` on the reviewed document commit; it passed. No implementation code or tests were changed
or run during this document review.

---

## Appendix — Fifth approval-review comments (2026-09-20, verbatim; all resolved above)

**Review verdict:** Not approved yet. The fourth-round revision materially improves the design, but two
blockers and several executable-contract gaps remain. The previous "Design approved" status was premature.

### 1. BLOCKER — the history seed still has no `runId`

Part F promises that the Workspace passes the displayed history entry's run id and that export therefore
matches the tab in every history position. The existing history lifecycle does not provide that id for the
entry that seeds the stepper on page load or scenario switch.

`ResultHistoryEntry` currently contains only `result`, `inputs`, and optional timing
(`Workspace.tsx:1264-1274`). The initial entry is constructed directly from `currentScenario.result` and
`currentScenario.inputs` (`Workspace.tsx:1455-1458`) with no originating solve-job id. After the user runs
another solve, that seeded entry becomes historical, but the server-owned export cannot address its stored
run. The existing `/solve-history` endpoint is not a sufficient implicit answer: it returns the newest job
of any status per scenario, which may be a later failed job, and Part F never specifies using it.

Correction: define the full run-id lifecycle, including:

- how the API exposes the job id that produced `scenario.result` (for example, a `resultRunId` in the
  Scenario response backed by a stored scenario reference or a reliable latest-successful-result lookup);
- `ResultHistoryEntry.runId` and how the initial seed receives it;
- how a newly completed solve attaches `pollingJobId` independently of whether timing timestamps exist;
- behavior for legacy results for which no retained run result exists; and
- results arriving through a background refetch or another tab/device.

Add this exact acceptance test: load an already-solved scenario, run another solve, step back to the
initially seeded result, and export it. The file must either match that result through a valid `runId`, or
the product must explicitly mark that legacy/unaddressable entry as non-exportable. The current universal
"every history position" claim cannot stand without this contract.

### 2. BLOCKER — required test 4b requests an unsupported Chen export

Required test 4b says the Chen `assignments`/`flows` export band column is populated. Chen's manifest
declares only `openWarehouses`, `assignments`, `costSummary`, and `serviceStats`; `flows` is not a supported
Chen output grid (`solvers/chens-cosmetics-cn/manifest.json:15`). The route correctly rejects an output
entity absent from the model's `outputGrids`, so this acceptance test cannot pass without an unrelated
product expansion.

Correction:

- assert Chen `assignments` bands are populated;
- test `flows` bands on the models that support flows (transport-coal, two-echelon-gold-au, and
  two-echelon-jade-us, as applicable); and
- define "all six models" as every supported band-bearing entity for each model, not an identical entity
  set across manifests.

### 3. HIGH — the field-scoped PATCH is not executable or demonstrably atomic yet

Decision 1f promises that a bands-only save changes only `distanceBands` across tabs, devices, cache
staleness, and history positions. The design does not lock the route, request/response schema, validation,
or database update needed to make that guarantee true.

A server endpoint that selects the full inputs blob, merges bands in application memory, and then writes
the full blob still has a read-modify-write race. To support the stated cross-device guarantee, define:

- the exact route (for example `PATCH /scenarios/:scenarioId/distance-bands`) and OpenAPI request/response;
- ownership and 404 behavior;
- model-specific band validation, including Chen and JADE's different cardinality/integer rules;
- an atomic `jsonb_set` update, or transaction/row-lock strategy, that cannot overwrite unrelated fields;
- non-staling timestamps and returned Scenario semantics; and
- invalid/missing body behavior.

The client-side state contract also needs correction. A dedicated lens that history stepping never replaces
cannot rely solely on `isBandsOnlyChange(savedInputsRef, localInputs)`, because history navigation does
replace `localInputs` and `savedInputsRef`. Define an independent saved-lens reference/dirty flag and make
the field-scoped save send the lens state directly. Cover edit → step history → Save, not only step history
→ edit → Save. Also define the ordering when both the lens and ordinary inputs are dirty.

### 4. HIGH — the shared objective/unit contract remains internally contradictory

Locked decision 6 makes the new pure `lib/units` workspace package authoritative for conversion math and
the six-model objective-dimension mapping. The normative Objective Units section still calls Studio's
`lib/objectiveFormat.ts` the single contract and says `modelId`/mode are referenced only there. Both
statements cannot be true.

Correction: rewrite the normative subsection so `@workspace/units` owns the typed model/mode → dimension
mapping and numeric conversion. `artifacts/studio/src/lib/objectiveFormat.ts` must be described only as a
presentation wrapper around that pure contract.

The shared package definition must also explicitly include **per-edge band assignment**
(`assignBandOrOverflow` or its replacement), not only cumulative coverage. Assignment and flow exports
need a distance-to-band function; a cumulative coverage helper cannot produce each row's band index.
Studio should import or re-export the same shared function so map, grid, and server export cannot drift.

### 5. HIGH — JADE assignment bands cannot be recomputed generically from `edges`

Part E says `assignments` recomputes `band` from `edges` plus the saved lens. That is incorrect for JADE.
JADE's exported assignment rows are product-level rows built from `result.details.assignments`, not
`result.edges` (`templates.ts:1463-1509`). Its current output also represents bands as strings such as
`"Band 2"`/`"Overflow"`, whereas the generic assignment schema uses a numeric band index or sentinel.

Correction: preserve each model's authoritative row source, then apply one shared distance-to-band
function to the row's distance:

- generic single-echelon assignments may use their serving edges;
- Gold must use its assignment/outbound contract rather than inbound flow edges; and
- JADE must use `details.assignments` for product-level rows.

Lock the versioned representation of `band` for generic and JADE CSV/JSON schemas—numeric index/sentinel
versus display label—and add per-model assignment/flow export fixtures. Do not claim that all assignment
rows are derived from raw `result.edges`.

### 6. HIGH — an incomplete draft can display one unit but commit as another

The authored-unit rule is deterministic but still violates the visible display-unit contract:

1. Type `5.` while the field is labelled km.
2. Toggle to mi; the draft remains `5.` with `authoredUnit = km`.
3. Type another `5`; the field visibly contains `5.5` while the surrounding UI is in mi.
4. Commit stores 5.5 km because the original authored unit is retained.

That is a silent semantic mismatch, even though it is testable. Lock one safe behavior:

- keep that field visibly labelled with its draft's `authoredUnit` until commit/cancel;
- convert and retarget the draft immediately when it becomes syntactically complete under the new display
  preference; or
- block the unit switch/further editing until the incomplete draft is resolved.

Add a UI test that asserts both the visible unit label and resulting canonical value for the
partial-toggle-complete sequence.

### 7. MEDIUM — run-addressed export needs query and stored-result boundary validation

Part F defines ownership and null-result behavior but not malformed query or malformed stored JSON
behavior. The current latest-result route validates `scenario.result` through `ResultEnvelopeSchema`; the
new job-result path must not trust jsonb more broadly.

Correction and tests:

- `runId` must be a finite positive integer; malformed, fractional, zero, and negative values return 400;
- a non-null `solve_jobs.result` is parsed through `ResultEnvelopeSchema.safeParse` before serialization;
- malformed stored envelopes return 422 rather than throwing or emitting invalid output; and
- `markSucceeded` stores `result` and `resultSummary` consistently for normal solver and cache-hit paths.

### Validated as sound in this review

- Free Chen bands with cumulative coverage and explicit overflow.
- Independent high-service and average-cap values with the golden model unchanged.
- Removal of both hardcoded 199M hints.
- Canonical storage and server-owned display-unit export conversion.
- Versioned distance-input contracts and `laneCosts.cost` preservation.
- Read-path loading gate while canonical unit metadata is unresolved.
- Correct six-model objective dimensions.
- Universal, validated `unit=` behavior for non-distance exports.
- Persisting full future solve results in nullable `solve_jobs.result` is a reasonable durability choice once
  the run-id lifecycle and validation boundaries are completed.

### Fifth approval-review verification performed

Reviewed the authoritative `chen-bands-units` branch at commit `06c9cc5` against the current Scenario API,
Workspace history seeding/append flow, solve polling handoff, solve-history endpoint, solve job schema and
runner, output capability manifests, generic and JADE export builders, shared-client download path, and all
four prior resolution sections. Ran `git diff --check HEAD^ HEAD`; it passed. No implementation code or
tests were changed or run during this document review.

---

## Appendix — Sixth approval-review comments (2026-09-20, verbatim; all resolved above)

**Review verdict:** Not approved yet. The fifth-round blockers are materially addressed in the normative
contract: the seeded history entry now has a durable `resultRunId`, unsupported Chen flow coverage was
removed from the test matrix, the band-only PATCH is specified as an atomic database operation, and the
unit/objective and per-model row-source ownership is substantially clearer. One internally impossible test
contract and four high-severity integration gaps remain.

### 1. BLOCKER — the required overflow assertions contradict the locked JADE representation

Required test 4 says that `OVERFLOW_BAND = -1` is emitted as-is across **all three export types**. Required
test 4c then says generic exports use numeric `-1` while JADE exports preserve the string `"Overflow"`.
Part A also locks JADE to the display-label strings `"Band N"` / `"Overflow"`. A JADE overflow value cannot
simultaneously be numeric `-1` and the string `"Overflow"`, so the required suite is not implementable as
written.

Correction:

- scope the literal `-1` export assertion to generic numeric band schemas;
- assert `"Overflow"` for JADE assignment and flow CSV/JSON schemas;
- retain the cross-cutting invariant that `OVERFLOW_BAND` is a categorical sentinel and is never
  unit-converted; and
- add boundary-equality and above-last-boundary fixtures for both representations so the shared numeric
  classification and schema-specific rendering cannot be conflated again.

### 2. HIGH — the both-dirty whole-input save can overwrite the independent live lens

The revised design correctly gives the lens an independent saved reference and dirty flag, and correctly
states that history stepping may replace `localInputs` and `savedInputsRef`. It then says that when the lens
and ordinary inputs are both dirty, Save uses the normal whole-input path "which already carries bands."
That is not guaranteed by the preceding state contract: after a lens edit and a history step, `localInputs`
may contain the stepped history entry's bands while the active lens lives only in the independent lens
state. A subsequent ordinary edit followed by Save can therefore persist the history/stale bands and lose
the user's lens edit.

Correction: lock construction of the whole-input payload as an explicit merge, for example
`{ ...localInputs, distanceBands: activeBandLens }`, immediately before validation and PATCH. The active
lens—not whichever band array happens to be in `localInputs`—must win. Extend the both-dirty acceptance
coverage with this exact sequence: edit lens → step history → edit an ordinary input → Save. Assert that
the ordinary value and the active lens are both persisted, every other latest non-band value is preserved,
the save takes the whole-input route, and staleness follows the ordinary-input change.

### 3. HIGH — specialized JADE output schemas do not yet satisfy the unit/version contract

Decision 5b requires every distance-bearing output file to contain values in the requested unit with an
explicit unit label, and Part E requires version bumps for the changed output schemas. The current
specialized JADE builders expose why a generic statement is insufficient:

- `JadeAssignmentTemplateRow` has `templateVersion` and `distanceUnit` in memory, but
  `jadeAssignmentRowsToCsv` emits only
  `product,customer,assigned_warehouse,distance,distance_band` (`templates.ts:1512-1517`);
- `JadeFlowTemplateRow` has `templateVersion` but no `distanceUnit`, and `jadeFlowRowsToCsv` emits only
  `leg,from_id,to_id,distance,distance_band,flows` (`templates.ts:1526-1576`); and
- consequently the specialized JSON and CSV contracts do not share a locked representation of requested
  unit and output-template version.

Correction: specify the exact version-2 CSV headers and JSON shapes for generic **and specialized JADE**
assignments/flows. Add a per-row unit/version field or define an explicit versioned document envelope for
formats where those values are not columns; either choice must make the downloaded artifact self-describing.
Lock CSV and JSON fixtures for both `unit=km` and `unit=mi`, including JADE flows. The version constant must
be observable in every versioned artifact, not merely exist on an intermediate TypeScript object that the
serializer drops.

### 4. HIGH — Part E still contradicts the per-model row-source decision

Part A correctly says that band recomputation applies the shared classifier to each builder row's own
distance and explicitly preserves JADE's product-level `details.assignments` source. Part E still says that
`assignments` and `flows` recompute band from `edges` plus the saved lens. This reintroduces the exact
fifth-review defect that the new Part A language resolved and leaves two normative implementation
instructions pointing in different directions.

Correction: replace the Part E `edges` statement with the Part A rule: retain each entity/model's existing
authoritative row source and apply `assignBandOrOverflow` to that row's distance. Reference the per-manifest
band-bearing entity matrix and schema-specific rendering contract rather than restating a generic edge
source.

### 5. HIGH — `result_run_id` referential and transactional integrity is not defined

The design adds `scenarios.result_run_id` and says `jobRunner` writes it at the same moment as the scenario
result, but it does not specify whether this column is a foreign key, what its delete action is, or the
transaction boundary. These omissions affect executable behavior:

- the current scenario-delete transaction deletes `solve_jobs` children first because
  `solve_jobs.scenario_id` has no cascade (`routes/scenarios.ts:258-278`); a default restrictive FK from
  `scenarios.result_run_id` back to one of those jobs creates a circular deletion dependency;
- `markSucceeded` currently updates the job and scenario in two independent statements
  (`solver/jobRunner.ts:283-310`), so a partial failure can leave a succeeded/addressable run whose scenario
  still points at an older result, or a scenario result without the promised run pointer; and
- saying the two fields are written "at the same moment" does not establish atomicity.

Correction:

- explicitly choose either a database FK or an application-maintained integer. If it is a FK, lock its
  action—`ON DELETE SET NULL` is compatible with retained legacy/non-exportable semantics—and update the
  scenario deletion order/behavior accordingly;
- require one database transaction to update `solve_jobs.status/result/resultSummary/finishedAt` and
  `scenarios.result/resultRunId/solvedAt/updatedAt` for normal and cache-hit success paths;
- state what happens when the scenario is deleted while a worker completes; and
- add migration/schema, scenario-delete, successful-solve, cache-hit, and forced mid-transaction failure
  tests proving that a committed `scenario.result` and `scenario.resultRunId` always identify the same
  committed job result.

### Validated as sound in this review

- The initial history entry receives its durable run identity from `Scenario.resultRunId`; newly completed
  runs use the polling id independently of timing metadata, and legacy null identities are non-exportable.
- The band-only route is now defined as an ownership-scoped, validation-backed, atomic `jsonb_set` PATCH
  that preserves unrelated concurrent input changes.
- The band-bearing export scope is correctly defined per manifest; Chen no longer has an impossible `flows`
  requirement.
- Incomplete numeric drafts are discarded on unit toggle, eliminating the visible-unit/authored-unit split.
- `@workspace/units` now owns objective dimensions, conversion, cumulative coverage, and
  `assignBandOrOverflow`; Studio is correctly described as a presentation wrapper.
- Run-addressed export validates positive integer ids and stored result envelopes, with deterministic
  400/404/422 boundaries.

### Sixth approval-review verification performed

Reviewed the authoritative `chen-bands-units` branch at commit `08a7a5c` against all fifth-review findings,
the revised normative decisions and required tests, the current Workspace history/save behavior, Scenario
PATCH/delete routes, solve-job schema and success writer, model capability manifests, and generic/JADE
output serializers. The worktree was clean before these review comments were added. Ran
`git diff --check HEAD^ HEAD` on the reviewed document commit; it passed. No implementation code or tests
were changed or run during this document review.
