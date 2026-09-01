# Workspace UX changes (R1–R9) — Design Spec (Bundle 1)

**Date:** 2026-09-01
**Status:** Draft for review (do not implement until approved)
**Context:** Post-Input-Map-v2 UX/bug batch requested by the user. Nine changes across the p-median-us Input Map symbology, the solve flow, the Solution Summary (compare rebuild), the Output Map, and Service Stats.
**Execution:** Bundle 1 of 3. This bundle → e2e → deploy, then Bundle 2 (#59/#60/#61 multi-model editor extension), then Bundle 3 (new models).

## Scope

Map/output items (**R1, R2, R3, R4, R7**) are **p-median-us first** (other models' maps still use the legacy pin flow — extended in Bundle 2). Solve-flow (**R5**), compare (**R6+R8**), and stats-label (**R9**) apply per their nature (mostly model-agnostic / same-model).

## Decisions (locked)

| # | Decision |
|---|----------|
| R1 | Supply=blue, demand=**green**, **p-median-us only**. Add scoped green tokens; two-echelon/transport-coal maps + two-echelon leg colors untouched. |
| R2 | **Discrete quintile** demand-bubble sizing (5 steps by percentile across the scenario's customers); legend shows 5 reference sizes + demand ranges. Replaces the absolute sqrt scale on the p-median-us input map. |
| R3 | **Bug fix:** only `forced_open` (filled) warehouses render; `active` (outline) + `inactive` (dashed) are invisible. Make all three render distinctly. |
| R4 | Move the Workspace **Save** control into the Input Map's `Layers:` toggle row — **Input Map tab only**. |
| R5 | **Run Optimizer** (`SolveDialog`) gains a distance-band range editor, prefilled with the model default, written to `inputs.distanceBands` before solve. Post-solve band editing **kept**. |
| R6+R8 | **Solution Summary → multi-scenario compare, no baseline.** Toggles pick **2–4 solved, non-stale, same-model** scenarios; a side-by-side table of **all cost + service metrics**; **1 selected = today's normal single-scenario summary**. Unsolved/stale scenarios shown **disabled**. |
| R7 | **Output Map hides closed candidates** — only solver-**opened** warehouses + their routes render (p-median-us first). |
| R9 | Service Stats graph labeled **"Percent of customers within the selected distance bands."** |

---

## R1 — Supply blue / demand green (p-median-us Input Map)

- New scoped green token ramp in `index.css` (e.g. `--demand-300/600` derived like the existing `--accent-*`, a muted green consistent with the Industry system's tonal approach — NOT a saturated primary green). Applied only where the p-median-us Input Map renders.
- `map/EntityMarkers.tsx` `customerBubbleSvg` (fill/stroke) and `map/MapLegend.tsx` demand swatches use the green tokens **when the model is p-median-us**; other models keep the accent (blue) bubble. Warehouse triangles stay blue for all.
- **Design detail (spec-level, low risk):** exact green hues — I'll pick values matching the steel-blue's saturation/lightness so it reads as a sibling, not a clashing primary. Flagged for visual review in the live e2e.
- **Acceptance:** on p-median-us, WH triangles blue, CS bubbles green, legend matches; transport-coal/two-echelon maps visually unchanged.

## R2 — Quintile demand-bubble sizing (p-median-us)

- Replace `demandRadius` (absolute sqrt) with a **quintile scale** for the p-median-us input map: compute the demand quintile thresholds across the current scenario's customers (base + added), map each of the 5 buckets to a fixed radius across a widened min→max range (clearly-stepped, e.g. 5/8/11/14/17px — tuned in-app).
- `MapLegend` shows **5 reference bubbles** with their demand ranges (e.g. "≤ p20", "p20–p40", …, or the actual demand values at the thresholds).
- Ties into R1: bubbles are green.
- **Edge cases:** < 5 distinct demands (degenerate quintiles) → fall back to fewer distinct sizes without crashing; a single-customer scenario → one size.
- **Acceptance:** two customers in the same quintile share a size; across quintiles sizes are visibly distinct; legend thresholds match the data.

## R3 — Warehouse-status rendering bug (p-median-us) [BUG]

- **Symptom:** only `forced_open` (filled) triangles appear; `active` (outline) and `inactive` (dashed) warehouses don't render at all.
- **Requires live diagnosis.** Candidate causes to check: (a) the outline/dashed triangle's `stroke` token (`--accent-700` / `--muted-foreground`) resolving to transparent/invisible inside the Leaflet marker pane; (b) the effective-row projection assigning base warehouses a status that maps to no marker; (c) a render gate filtering non-`forced_open` markers. Diagnose against the live app (`claude-in-chrome` or the Playwright harness) before fixing.
- **Fix:** all three statuses render, visibly distinct (`active`→outline, `forced_open`→filled, `inactive`→dashed, inactive still behind the Show-inactive toggle). Add an EntityMarkers test asserting a rendered outline/dashed marker actually paints (not just that a marker element exists).
- **Acceptance:** a scenario with a mix of statuses shows all three on the map.

## R4 — Save button into the Layers row (Input Map only)

- On the Input Map tab, render the Workspace Save control (and its dirty/"unsaved" indicator) inline within the layer-toggle row (`Layers: [Warehouses][Customers][Show inactive] … [Save]`). Other tabs' Save placement (the existing toolbar) unchanged.
- Reuses the existing save handler/state — layout-only move, no new save logic.
- **Acceptance:** on the Input Map, Save sits in the Layers row and works (saves dirty edits, reflects clean/dirty); on other input tabs, Save is where it is today.

## R5 — Pre-solve distance bands in Run Optimizer

- `SolveDialog` (Run Optimizer) gains a **distance-band range editor** (reuse the existing post-solve band-editor component if practical), prefilled from the current `inputs.distanceBands` (default = the model's manifest default). On solve, the edited bands are written to `inputs.distanceBands` (saved) **before** the solve is enqueued — consistent with the "save-then-solve" pattern already in the dialog.
- The **post-solve** band editor (results reporting lens) stays as-is.
- Model-agnostic: every model has `distanceBands`, so this benefits all — but visual/QA focus is p-median-us for Bundle 1.
- **Acceptance:** editing bands in Run Optimizer and solving yields band-coverage computed against those bands; bands persist on the scenario; post-solve editing still works.

## R6 + R8 — Solution Summary as multi-scenario compare (no baseline)

The biggest item — rebuilds the compare capability removed in Phase 3.2, folded into the Solution Summary tab, baseline-free.

- **Selection:** the Solution Summary tab gains a **scenario toggle list** (checkboxes) of the current model's scenarios. Only **solved, non-stale** scenarios are selectable; unsolved/stale ones render **disabled** with a hint ("solve first"). 1–4 selectable; enforce the 2–4 range for the compare view.
- **View:**
  - **1 selected** → today's normal single-scenario Solution Summary (unchanged).
  - **2–4 selected** → a side-by-side table: **columns = scenarios** (in selection order, no baseline anchor), **rows = metrics**: objective, open-warehouse count, weighted-avg distance, band coverage (per band), warehouse utilization summary, and the service-stats metrics. Each cell reads that scenario's own result envelope.
- **Data:** each scenario row already carries its `result` envelope (`GET /scenarios/:id`), so the frontend fetches the selected scenarios and renders columns — **no baseline diff, no new compare endpoint required** (confirm during planning whether a batch fetch is worth it vs N queries; the deleted `POST /scenarios/compare` is NOT resurrected). Same-model + solved + non-stale gating enforced client-side (and defensively if any fetch returns a stale/absent result).
- **No baseline:** no "vs baseline" deltas by default — just the values per column. (If deltas are wanted later, that's a follow-up; not in this spec.)
- **Acceptance:** toggling 2–4 solved same-model scenarios shows their metrics side by side; an unsolved scenario can't be added; 1 scenario shows the normal summary; cross-model selection impossible (list is single-model).

## R7 — Output Map hides closed candidates (p-median-us)

- On the Output Map (`OutputMapTab`/`NetworkMap` output rendering), render **only** warehouses the solver opened (those appearing as an edge `fromId` / in `openWarehouseIds`) plus their routes. Closed candidate warehouses are **not** drawn.
- Applies to the **output** map only (the Input Map still shows all candidates — that's the editing surface). p-median-us first.
- **Acceptance:** after a solve, the Output Map shows only opened warehouses + routes; closed candidates absent; customer markers unchanged.

## R9 — Service Stats graph label

- Label the Service Stats chart **"Percent of customers within the selected distance bands"** (as the chart title or y-axis label — pick the clearer per the existing chart; confirm in review). Trivial, no logic change.
- **Acceptance:** the label text is present on the chart.

---

## Testing strategy

- **RTL/unit:** R1 (green tokens applied on p-median-us bubbles/legend, not other models), R2 (quintile bucketing + legend thresholds + degenerate-data fallback), R3 (outline/dashed markers render — regression guard), R4 (Save in the Layers row on Input Map, unchanged elsewhere), R5 (bands editor in SolveDialog writes distanceBands before solve), R6+R8 (toggle gating: only-solved selectable, 1 vs 2–4 rendering, cross-model impossible, per-column metrics), R7 (closed warehouses filtered from output map), R9 (label present).
- **Live Playwright (the bundle e2e):** the money-path still works; R3 statuses visibly render; R2 buckets distinguishable; R5 bands set pre-solve flow; R6+R8 select 2–4 solved scenarios → side-by-side; R7 output map shows only open WHs.
- **Sacred:** no solver change expected → `e2e_accuracy.py` stays 87/87 (verify — R5 touches `inputs.distanceBands` handling but not solve.py; band coverage is already computed from bands).
- Full gate (typecheck, api-server, studio) green before e2e/deploy.

## Out of scope (this bundle)

- Extending any of R1–R9 to other models (Bundle 2 / tasks #59–61).
- Baseline/delta comparisons in R6+R8 (values-only for now).
- Any solver/dataset change.
