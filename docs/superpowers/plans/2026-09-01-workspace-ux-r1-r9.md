# Workspace UX (R1–R9) — Implementation Plan (Bundle 1)

> **For agentic workers:** Executed via the **agent team** (frontend-engineer / backend-engineer / solver-engineer / qa-sdet). Controller cherry-picks each task, re-runs the full gate on the combined state, merges. **Held for user review — do not build until approved.** Rev 2 — incorporates the plan review round.

**Goal:** Ship R1–R9 for the p-median-us Workspace: symbology (blue/green, quintile bubbles, status-render bug), Save relocation, pre-solve distance bands, Solution-Summary multi-scenario compare, output-map closed-WH hiding, Service-Stats label.

**Spec:** `docs/superpowers/specs/2026-09-01-workspace-ux-r1-r9-design.md` (rev 3).

**Tech Stack:** React + Vite + react-leaflet + TanStack Query; Express + Drizzle + Zod (R5 manifest); PuLP/CBC (no change).

## Global Constraints

- **Token convention (fixes R1+R3):** numbered tokens (`--accent-*`, new `--demand-*`) are **complete colors**; SVG consumes them as **`var(--token)`**, never `hsl(var(--token))`. shadcn channel tokens (`--muted-foreground`) stay `hsl(var(...))` — verify each.
- **`displayedInputs` principle (P1):** every OUTPUT surface (Output Map route/band coloring, band coverage, Service Stats, R7's effective dataset) reads the **inputs snapshot associated with the displayed solve** — a `displayedInputs` derived alongside the existing `displayedResult` — **never** the editable `localInputs` draft. Editing bands/coords in the dialog or Optimization Parameters must not recolor or re-geometry the currently-displayed (older) solution. This is what keeps R5 a solve-input (not a post-solve lens).
- **p-median-us scope** for map/output items (R1/R2/R3/R4/R7); gate on `mode === "pmedian"` / `modelId === "p-median-us"` — legacy Input Maps unchanged.
- **No solver/dataset change.** `e2e_accuracy.py` passes **87/87 unchanged** (R5 writes `inputs.distanceBands` only; R9 is label-only).
- **Manual-Save-only** contract unchanged.
- **No two parallel tasks edit the same file** (esp. `pages/Workspace.tsx`) — the Workspace-hub tasks are **serialized** (Wave 2).
- One task = one commit `[<id>] <summary>` + `Co-Authored-By` trailer.
- **Gate** per wave: `pnpm run typecheck && pnpm --filter api-server test && pnpm --filter studio test` (api-server needs `DATABASE_URL="postgresql://shubhamkr@localhost:5432/nos_dev"`). `e2e_accuracy.py` once at the end.

---

## Waves

| Wave | Tasks | Notes |
|------|-------|-------|
| 1 (parallel) | **T1** symbology (R1/R2/R3) · **T2** R5 manifest unit (solver-engineer) · **T3** R9 label | disjoint files |
| 2 (**serial** — all edit `Workspace.tsx`) | **T4** R5 dialog+wiring + `displayedInputs` + R4 → **T5** R6+R8 compare → **T6** R7 output | one-at-a-time on Workspace.tsx |
| 3 | **T7** QA + live Playwright e2e | final |

---

## Task T1 — Symbology: token fix (R3) + green demand (R1) + quintile bubbles (R2)

**Role:** frontend-engineer. **Files:** `index.css`, `map/EntityMarkers.tsx`, `map/MapLegend.tsx`, `map/types.ts` + tests.

- [ ] **Step 1 — R3 token bug (first).** Replace every `hsl(var(--accent-NNN))` in `EntityMarkers.tsx` with `var(--accent-NNN)` (tokens are already complete colors, `index.css:420-425`). Verify `--muted-foreground` (channel token → stays `hsl(var(...))`, or complete → unwrap). Unit test: generated SVG contains `var(--accent-700)`, not `hsl(var(--accent-700))`.
- [ ] **Step 2 — R1 green tokens.** Add `--demand-300/600` to `index.css` as **complete colors** (relative-color pattern, muted green sibling to the accent). `EntityMarkers.customerBubbleSvg` uses `var(--demand-300)`/`var(--demand-600)` when `modelId === "p-median-us"`, else accent; thread `modelId`/`demandColor` in. `MapLegend` demand swatches match.
- [ ] **Step 3 — R2 quintile scale.** `types.ts`: `makeQuintileRadius(demands: number[])`. Algorithm (**single correct formula**): sort ascending; p20/p40/p60/p80 by linear-interpolation-between-ranks (type-7); bucket 0 = `d ≤ p20`; bucket k (1–4) = `p₂₀ₖ < d ≤ p₂₀₍ₖ₊₁₎` (**lower-exclusive, upper-inclusive**); 5 fixed radii `[5,8,11,14,17]`. Expose thresholds + radii-actually-used (legend + collapse). `<5` distinct / single customer → no crash. **`demands` = ALL of the scenario's customers (base + added, INCLUDING excluded) — excluded demands count toward the thresholds.**
- [ ] **Step 4 — excluded markers (dim, in-scale).** Excluded customers render **dimmed** (click-to-un-exclude preserved) AND **participate in the quintile scale** — sized by their own demand's bucket like any other customer (dim, not fixed-size, not hidden). RTL: an excluded customer renders with the dim class AND is sized by its quintile (its demand is part of the threshold population).
- [ ] **Step 5 — legend.** `MapLegend`: up-to-5 reference bubbles at the quintile radii + demand-range labels; collapse to distinct sizes when thresholds repeat.
- [ ] **Step 6 — tests + commit.** Unit: R3 syntax; quintile determinism (boundary `d==p20`→bucket0, excluded-count-in-thresholds, degenerate, collapse); green only for p-median-us. RTL: green vs accent bubbles by model; excluded dim + sized-by-quintile (in-scale); legend rows. `pnpm --filter studio test EntityMarkers MapLegend demandScale statusPresentation` + typecheck. Commit `[T1] symbology: token fix (R3) + green demand (R1) + quintile bubbles (R2)`.

## Task T2 — R5 backend: distance-unit manifest metadata (mandatory contract)

**Role:** **solver-engineer** (owns `solvers/*/manifest.json`; coordinate the shared `ManifestSchema` seam with backend). **Files:** `solvers/*/manifest.json`, `lib/dataset-schema/src/index.ts`, `registry/modelRegistry.ts`, `lib/api-spec/openapi.yaml` + codegen, `routes` model serialization + tests.

- [ ] **Step 1.** `ManifestSchema` gains `distanceUnit: z.enum(["mi","km"]).optional()`.
- [ ] **Step 2.** Set it per manifest: `mi` for p-median-us / p-median-brazil / transport-coal; **`km`** for two-echelon-gold-au (verify against its actual UI unit; if it reports mi, use mi).
- [ ] **Step 3 — public contract (mandatory).** The frontend reads `distanceUnit` from `useListModels` (the only frontend-exposed manifest path). Add `distanceUnit` to `openapi.yaml`'s `ModelInfo`/`PublicModelInfo`, regenerate codegen (`lib/api-zod`/`lib/api-client-react` — spec+codegen same commit). `modelRegistry`/the models route serialization emits it, defaulting absent → **`"mi"`** at the public boundary (`toPublic(m.distanceUnit ?? "mi")`). Add API test that `GET /api/models` returns the right unit per model.
- [ ] **Step 4 — tests + commit.** dataset-schema: manifest with/without `distanceUnit` validates. `pnpm --filter @workspace/dataset-schema test` + api-server registry/models test + `pnpm run typecheck`. Commit `[T2] distanceUnit manifest + public ModelInfo contract (R5)`.

## Task T3 — R9 Service Stats label (+ unit)

**Role:** frontend-engineer. **Files:** `tabs/ServiceStatsTab.tsx` + test.

- [ ] **Step 1.** Label the chart **"Percent of demand served within the selected distance bands"** (demand-weighted; no metric/logic change). Band labels/axis on this chart use the model's `distanceUnit` (from `useListModels`) instead of a hardcoded `mi`.
- [ ] **Step 2 — test + commit.** RTL: label text present; a two-echelon render shows `km` on the band labels. Commit `[T3] Service Stats demand-weighted label + unit (R9)`.

## Task T4 — R5 dialog + `displayedInputs` foundation + R4 Save-in-Layers

**Role:** frontend-engineer. **Depends on:** T2. **Wave 2, first (Workspace.tsx).** **Files:** `SolveDialog.tsx`, `pages/Workspace.tsx`, `tabs/InputMapTab.tsx` + tests.

- [ ] **Step 1 — `displayedInputs` (foundation for T5/T6).** In `Workspace.tsx`, derive `displayedInputs` alongside the existing `displayedResult` (the inputs snapshot the displayed solve used — from the solve-jobs/result history entry, mirroring `displayedResult`). Repoint every OUTPUT surface's band source from `distanceBandsFromInputs(localInputs)` to `displayedInputs` (Output Map coloring, band coverage, Service Stats). The **editable** draft (`localInputs`) is only for Optimization Parameters + the solve dialog.
- [ ] **Step 2 — R5 SolveDialog bands.** `SolveDialog` gains a distance-band editor two-way synced with the **draft** `inputs.distanceBands` (same mechanism as `gap`/`p`), prefilled from the scenario; label shows the model's `distanceUnit` (T2). On solve, bands persist with the existing save-then-solve; the solved bands become part of `displayedInputs` for that result. **No** post-solve re-band of an existing result.
- [ ] **Step 3 — R4 Save-in-Layers (gated).** On the Input Map tab **only when `mode === "pmedian"`** (p-median-us), render the Save control + dirty indicator inline in the `Layers:` row (move it out of the toolbar for that case). Legacy Input Maps (transport/two-echelon) keep the existing toolbar Save.
- [ ] **Step 4 — tests + commit.** RTL: editing bands in the dialog + solving includes `distanceBands` in the saved inputs; unit label per model; **editing draft bands does NOT recolor the currently-displayed Output Map** (reads `displayedInputs`); R4 Save in the Layers row for p-median-us, toolbar for a legacy model. `pnpm --filter studio test SolveDialog Workspace InputMapTab OutputMap` + typecheck. Commit `[T4] pre-solve bands + displayedInputs snapshot + Save-in-Layers (R5, R4)`.

## Task T5 — R6+R8 Solution Summary multi-scenario compare

**Role:** frontend-engineer. **Depends on:** T4 (Workspace.tsx). **Wave 2, second.** **Files:** `tabs/CostSummaryTab.tsx`, `pages/Workspace.tsx` + tests.

- [ ] **Step 1 — selection.** Scenario toggle list (checkboxes) of the **current model's** scenarios; only **solved + non-stale** enabled, others disabled with a "solve first" hint; enforce 2–4 for compare; cross-model impossible. While the active scenario browses result-history (non-latest `displayedResult`), **disable the toggles** with a return-to-latest hint.
- [ ] **Step 2 — data.** Read each selected scenario's **latest persisted `result`** (per-scenario `getScenario`; no `POST /scenarios/compare`).
- [ ] **Step 3 — capability-driven metric-row registry.** Define the compare rows by model capability, NOT assuming facility-location for all:
  - **Always:** objective, weighted-avg distance (with the model's `distanceUnit`), runtime, quality.
  - **Facility-location models only** (a capability flag — p-median-us/brazil; NOT transport-coal where every mine is "open", NOT two-echelon whose utilization holds closed refineries at 0): open-facility count; **aggregate utilization** = mean of `utilizationByNode[].utilization` over **opened** nodes only (empty/no-facility → N/A).
  - **Per-band coverage:** only when all selected scenarios share identical bands (band-for-band); else a note listing each scenario's own bands. **Omitted from the shared table otherwise.**
  - Single-scenario (1 selected) → today's `CostSummaryTab` unchanged (incl. Download CSV). Compare mode (2–4) → **Download CSV hidden**.
- [ ] **Step 4 — tests + commit.** RTL incl. **transport-coal and two-echelon** fixtures (not only p-median): only-solved selectable; cross-model impossible; scalar rows per column; facility rows present for p-median / **absent (N/A) for transport-coal + two-echelon**; identical-bands→per-band rows, differing→note; history disables toggles; unit in headings; CSV hidden in compare. `pnpm --filter studio test CostSummary Workspace` + typecheck. Commit `[T5] Solution Summary multi-scenario compare, capability-driven metrics (R6+R8)`.

## Task T6 — R7 output map hides closed WHs (over `displayedInputs`)

**Role:** frontend-engineer. **Depends on:** T4 (`displayedInputs`), T5 (Workspace.tsx). **Wave 2, third.** **Files:** `tabs/OutputMapTab.tsx`, `components/NetworkMap.tsx`, `pages/Workspace.tsx` + tests.

- [ ] **Step 1 — effective OUTPUT dataset from the solve snapshot.** Build it from **`displayedInputs`** paired with `displayedResult` (base dataset ∪ that snapshot's added warehouses/customers at **their solve-time coords**) — NOT `localInputs`' current draft coords. So an unsaved move or a stepped-back history result renders the geometry that solve used.
- [ ] **Step 2 — opened-only filter.** Render only warehouses the solver opened (edge `fromId` / `openWarehouseIds`) + routes; closed candidates omitted; customers unchanged. `mode === "pmedian"` (p-median-us) only.
- [ ] **Step 3 — tests + commit.** RTL: closed candidate absent; **an added warehouse opened + its route to an added/base customer renders**; **an unsaved coordinate edit does NOT move the displayed solve's endpoints**; a **stepped-back history result renders its own geometry**; legacy models' output unchanged. `pnpm --filter studio test OutputMap NetworkMap Workspace` + typecheck. Commit `[T6] output map: effective dataset from displayedInputs + hide closed WHs (R7)`.

## Task T7 — QA: integration + live Playwright e2e

**Role:** qa-sdet. **Depends on:** T1–T6 merged.

- [ ] **Step 1 — full gate:** typecheck, api-server, studio green; **`e2e_accuracy.py` 87/87** unchanged.
- [ ] **Step 2 — live Playwright** (dev servers; disposable scenario cleaned up): money-path; **R3 outline+dashed markers actually paint** (computed style/screenshot); **R2** stepped bubbles + excluded dim; **R1** green bubbles; **R5** set bands in Run Optimizer → solve uses them, and editing draft bands does not recolor the shown result; **R6+R8** 2–4 solved scenarios side-by-side (+ a transport-coal/two-echelon compare showing N/A facility rows); **R7** only opened WHs incl. an added one; **R4** Save in Layers row (p-median-us) / toolbar (legacy); **R9** demand label + unit. Report real defects; clean up.
- [ ] **Step 3 — commit** `[T7] R1-R9 QA — integration + live Playwright e2e`.

---

## Self-review checklist (controller, before merge)

- [ ] Full gate green; `e2e_accuracy.py` 87/87 unchanged.
- [ ] Live Playwright: all R1–R9; R3 proven to paint in a real browser; output surfaces read `displayedInputs` (draft edits don't recolor/re-geometry the shown solve).
- [ ] No solver/dataset change; only R5's `manifest.json` + schema/contract.
- [ ] No `hsl(var(--complete-color))` left; token convention consistent.
- [ ] Compare correct for a non-facility model (transport-coal N/A rows) — not just p-median.
- [ ] `mode==="pmedian"` gating holds (legacy Input/Output maps unchanged).
- [ ] Merge to local main; push + Render deploy after user go-ahead.
