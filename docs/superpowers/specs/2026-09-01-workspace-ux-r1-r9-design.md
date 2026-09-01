# Workspace UX changes (R1–R9) — Design Spec (Bundle 1)

**Date:** 2026-09-01 (rev. 2 — incorporates review round)
**Status:** Reviewed — ready for planning
**Context:** Post-Input-Map-v2 UX/bug batch. Nine changes across the p-median-us Input Map symbology, the solve flow, the Solution Summary (compare rebuild), the Output Map, and Service Stats.
**Execution:** Bundle 1 of 3 → e2e → deploy, then Bundle 2 (multi-model editor extension), then Bundle 3 (new models).

## Scope

Map/output items (**R1, R2, R3, R4, R7**) are **p-median-us first**. Solve-flow (**R5**), compare (**R6+R8**), stats-label (**R9**) apply per their nature.

## Decisions (locked)

| # | Decision |
|---|----------|
| R1 | Supply=blue, demand=**green**, **p-median-us only**. New scoped green tokens. |
| R2 | **Discrete quintile** demand-bubble sizing (deterministic algorithm, §R2). |
| R3 | **Bug fix:** nested `hsl(var(--complete-color))` renders outline/dashed invisible. Root cause found (§R3). |
| R4 | Move **Save** into the Input Map's `Layers:` row — Input Map tab only. |
| R5 | Bands are a **persisted solve input** — editable pre-solve in Optimization Parameters **and** the new Run Optimizer editor. **No** post-solve reporting lens in Workspace (that only ever existed in legacy Studio). |
| R6+R8 | **Solution Summary → multi-scenario compare, no baseline.** 2–4 **solved, non-stale, same-model** scenarios; side-by-side scalar metrics; per-band coverage shown **only when all selected scenarios share identical bands** (else a per-scenario note); 1 selected = normal summary. |
| R7 | **Output Map hides closed candidates** — over an **effective output dataset** (base + added). |
| R9 | Service Stats graph labeled **"Percent of demand served within the selected distance bands"** (demand-weighted — matches the actual metric). |

**Cross-cutting token convention (fixes R1 + R3):** the numbered tokens (`--accent-300/600/700`, and the new `--demand-*`) are **complete colors** (`hsl(from …)`). Marker/legend SVG must consume them as **`var(--token)`**, never `hsl(var(--token))` (which produces an invalid nested color). shadcn channel-tokens (e.g. `--muted-foreground`) stay `hsl(var(--muted-foreground))`. One rule, documented at the token site.

---

## R1 — Supply blue / demand green (p-median-us Input Map)

- Add a scoped **green token ramp** to `index.css` — `--demand-300/600` (and any needed steps) declared as **complete colors** using the same relative-color-syntax pattern as `--accent-*`, in a muted green sibling to the steel-blue (not a saturated primary).
- `map/EntityMarkers.tsx` `customerBubbleSvg` (fill/stroke) and `map/MapLegend.tsx` demand swatches consume the green via **`var(--demand-*)`** (unwrapped) **when `modelId === "p-median-us"`**; other models keep the accent (blue) bubble. Warehouse triangles stay blue for all.
- Exact green hues chosen to match the accent's saturation/lightness; **visual review in the live e2e**.
- **Acceptance:** on p-median-us, WH triangles blue, CS bubbles green, legend matches; transport-coal/two-echelon maps visually unchanged.

## R2 — Quintile demand-bubble sizing (p-median-us) — deterministic spec

- **Population:** the current scenario's customers that participate in the map — base customers **not excluded** (per `customerOverrides` status `"excluded"`) plus added customers. **Excluded customers are omitted** from the scale (and not rendered/sized).
- **Algorithm:** sort the participating demands ascending; compute the 20/40/60/80th percentile thresholds by **linear interpolation between closest ranks** (the `type=7`/`numpy.percentile` default). Assign a customer to bucket `k` (0–4) by **lower-inclusive, upper-exclusive** bands: bucket 0 = `demand ≤ p20`; bucket `k` = `p_{20k} < demand ≤ p_{20(k+1)}`; bucket 4 = `demand > p80`. (Exactly-on-threshold → the lower bucket.)
- **Radii:** 5 fixed stepped radii across a widened range (e.g. 5/8/11/14/17px, tuned in-app).
- **Legend:** 5 reference bubbles labeled with each bucket's demand range (the threshold values). **Repeated thresholds** (e.g. many identical demands) that collapse buckets → collapse the legend to the distinct sizes actually used; never render an empty/degenerate bucket row.
- **Degenerate data:** < 5 distinct demands → fewer distinct sizes, no crash; single customer → one size.
- **Acceptance:** two demands in the same bucket share a size; across buckets sizes visibly differ; legend thresholds match the computed percentiles; an all-equal-demand scenario shows one size + one legend row.

## R3 — Warehouse-status rendering bug (p-median-us) [BUG — root cause found]

- **Root cause:** `--accent-700` (and siblings) are **complete colors**; `EntityMarkers`' SVG wraps them as `hsl(var(--accent-700))` = invalid nested color. On an invalid `fill`, SVG falls back to the default **black** (so `forced_open`/filled renders, as black); on an invalid `stroke`, SVG falls back to **none** (so `active`/outline and `inactive`/dashed get no stroke and, with `fill="none"`, are **invisible**). This is why only Fixed-Open showed.
- **Fix:** consume the tokens **unwrapped** (`var(--accent-700)`, `var(--muted-foreground)` stays wrapped only if it's a channel-token — verify each) so all three statuses paint their intended colors. Same fix underpins R1's green tokens (the cross-cutting convention above).
- **Testing:** a unit assertion on the generated SVG string (correct `var(--token)` syntax, no nested `hsl(var(...))`); the **"actually paints"** regression lives in **Playwright** via browser-resolved computed styles / a focused screenshot assertion for the outline and dashed markers (jsdom cannot prove a custom-property-bearing SVG attribute paints).
- **Acceptance:** a mixed-status scenario shows outline (active), filled (forced_open), and dashed (inactive, behind the Show-inactive toggle) — all visible with their intended colors.

## R4 — Save button into the Layers row (Input Map only)

- On the Input Map tab, render the Workspace Save control + dirty indicator inline in the layer-toggle row (`Layers: [Warehouses][Customers][Show inactive] … [Save]`). Other tabs' Save unchanged. Reuses the existing save handler/state — layout-only.
- **Acceptance:** on the Input Map, Save is in the Layers row and works; elsewhere unchanged.

## R5 — Distance bands as a persisted solve input (Run Optimizer + Optimization Parameters)

Correcting the review's P1: Workspace has **no** post-solve band lens (that lives only in legacy `Studio.tsx`). Bands here are a **single persisted solve input**.

- `SolveDialog` (Run Optimizer) gains a **distance-band range editor**, prefilled from the scenario's current `inputs.distanceBands` (default = the model's manifest default). On solve it writes the edited bands to `inputs.distanceBands` (saved) **before** enqueue — the existing save-then-solve path. The same `inputs.distanceBands` remains editable in the **Optimization Parameters** tab (they're the same field/state — one source of truth, `solveBands`).
- These bands drive band-coverage, Output Map band coloring, and the next solve. **No** transient `reportBands` / re-band-without-re-solve in Workspace.
- **Distance unit (review P2):** add a **distance-unit** to the manifest/registry (`"mi"` for US models, `"km"` for two-echelon-gold-au); the bands editor label displays the correct unit. (Optional metadata; existing models default to `"mi"`.)
- **Acceptance:** editing bands in Run Optimizer → solve uses them; bands persist and match the Optimization Parameters tab; the editor shows the model's unit; band coverage/Output-Map coloring reflect the solved bands.

## R6 + R8 — Solution Summary as multi-scenario compare (no baseline)

Rebuilds compare (removed in Phase 3.2), folded into Solution Summary, baseline-free. Scalar metrics side by side, plus per-band coverage **when the selected scenarios share identical bands**.

- **Selection:** a **scenario toggle list** (checkboxes) of the current model's scenarios. Only **solved, non-stale** scenarios are selectable; unsolved/stale ones render **disabled** with a "solve first" hint. Enforce **2–4** for the compare view. Cross-model impossible (list is single-model).
- **Result source:** compare reads each selected scenario's **latest persisted `result`** (`GET /scenarios/:id`). While the **active** scenario is browsing session **result-history** (a non-latest `displayedResult`), the compare toggles are **disabled** with a hint to return to the latest result — so a historical view never silently becomes a compare column. No new compare endpoint; the deleted `POST /scenarios/compare` is not resurrected (batch-vs-N-fetch decided in planning).
- **View:**
  - **1 selected** → today's normal single-scenario Solution Summary (unchanged), including its Download CSV.
  - **2–4 selected** → a side-by-side table: **columns = scenarios** (selection order, no baseline), **rows = scalar metrics**: objective, open-warehouse count, weighted-avg distance, **aggregate warehouse utilization** (one scalar per scenario — e.g. mean utilization across that scenario's open warehouses; NOT per-facility, since open-facility ids differ across columns), and the scalar service-stats numbers. **Per-band coverage** rows appear **only when all selected scenarios share identical band boundaries** (compare their coverage band-for-band); if bands differ (R5 makes them a per-scenario input), those rows are replaced with a short note listing each scenario's own bands — never re-bucketed onto a shared axis. The single-scenario **Download CSV is hidden in compare mode** (compare is a read-only side-by-side; a combined export is a later follow-up, not this bundle).
- **Acceptance:** 2–4 solved same-model scenarios show scalar metrics side by side; an unsolved scenario can't be added; 1 selected shows the normal summary; browsing history disables the compare toggles; cross-model selection impossible.

## R7 — Output Map hides closed candidates (p-median-us)

- Build an **effective output dataset** = the base dataset **plus** this scenario's added warehouses/customers (with their current coordinates), then render **only** warehouses the solver opened (edge `fromId` / `openWarehouseIds`) + their routes. Filtering the base dataset alone is insufficient — added open warehouses (and added customers served by them) live only in the scenario's added entities, and `NetworkMap` would drop any route endpoint it can't find in the base dataset.
- Output map only (the Input Map still shows all candidates). p-median-us first.
- **Acceptance:** after a solve, the Output Map shows only opened warehouses + routes; closed candidates absent; **an added warehouse that was opened renders and its route to an added-or-base customer renders**; customer markers unchanged.

## R9 — Service Stats graph label

- Label the Service Stats chart **"Percent of demand served within the selected distance bands"** (title or y-axis, whichever is clearer on the existing chart). This matches the actual metric: `metrics.bandCoverage[].percent` is **demand/flow-weighted**, not a customer count — the originally-requested "percent of customers" wording would misrepresent the data. **No logic change** (label only); the metric and its solve-time snapshot semantics are unchanged.
- **Acceptance:** the corrected, demand-based label is present on the chart.

---

## Testing strategy

- **RTL/unit:** R1 (green `var(--demand-*)` consumed on p-median-us bubbles/legend, not other models; correct SVG syntax), R2 (quintile bucketing determinism + threshold boundary + excluded-omitted + degenerate fallback + legend collapse), R3 (SVG string uses `var(--token)`, no nested `hsl(var(...))`), R4 (Save in the Layers row on Input Map, unchanged elsewhere), R5 (Run Optimizer bands editor writes `distanceBands` before solve; unit label from manifest), R6+R8 (only-solved selectable, history disables toggles, 1 vs 2–4 rendering, cross-model impossible, scalar rows incl. aggregate utilization, per-band rows shown when bands identical / a per-scenario note when they differ, CSV hidden in compare), R7 (effective dataset built; closed WHs filtered; added-open-WH retained), R9 (corrected label present).
- **Live Playwright (bundle e2e):** money-path still works; **R3 outline + dashed markers actually paint** (computed style/screenshot); R2 buckets distinguishable; R5 pre-solve bands flow; R6+R8 select 2–4 solved scenarios → side-by-side scalar table; R7 output map shows only opened WHs incl. an added one.
- **Sacred:** no solver/`solve.py` change → `e2e_accuracy.py` stays 87/87 (R5 only writes `inputs.distanceBands`, already consumed; R9 is label-only). Verify.
- Full gate (typecheck, api-server, studio) green before e2e/deploy.

## Out of scope (this bundle)

- Extending R1–R9 to other models (Bundle 2).
- Baseline/delta comparisons and a combined compare-CSV export in R6+R8 (values-only, no export for now).
- A transient post-solve `reportBands` lens in Workspace (R5 is solve-input only).
- Any solver/dataset change.
