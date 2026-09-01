# Workspace UX (R1–R9) — Implementation Plan (Bundle 1)

> **For agentic workers:** Executed via the **agent team** (parallel role-based dispatch; frontend-engineer / backend-engineer / qa-sdet), NOT sequential subagent-driven-development. Controller cherry-picks each task, re-runs the full gate on the combined state, merges. Steps use checkbox syntax. **Held for user review — do not build until approved.**

**Goal:** Ship the nine R1–R9 UX/bug changes for the p-median-us Workspace: symbology (blue/green, quintile bubbles, status-render bug), Save relocation, pre-solve distance bands, Solution-Summary multi-scenario compare, output-map closed-WH hiding, Service-Stats label.

**Spec:** `docs/superpowers/specs/2026-09-01-workspace-ux-r1-r9-design.md` (rev 2). Read its Decisions table + per-R sections + the cross-cutting token convention.

**Tech Stack:** React + Vite + react-leaflet + TanStack Query (frontend); Express + Drizzle + Zod (backend, R5 manifest only). No solver change.

## Global Constraints

- **Token convention (fixes R1+R3):** numbered tokens (`--accent-*`, new `--demand-*`) are **complete colors**; SVG consumes them as **`var(--token)`**, never `hsl(var(--token))`. shadcn channel tokens (`--muted-foreground`) stay `hsl(var(...))` — verify each.
- **p-median-us scope** for map/output items (R1/R2/R3/R4/R7). Other models' maps/output visually unchanged.
- **No solver/dataset change.** `e2e_accuracy.py` must pass **87/87 unchanged**. R5 only writes `inputs.distanceBands` (already consumed); R9 is label-only.
- **No generated-code edits** except via OpenAPI codegen (R5 if `ModelInfo` gains `distanceUnit`).
- **Manual-Save-only** Workspace contract unchanged.
- **Compare reads latest persisted result**, never session history; toggles disabled while the active scenario browses history.
- One task = one commit `[<id>] <summary>` + `Co-Authored-By` trailer.
- **Gate** before a wave closes: `pnpm run typecheck && pnpm --filter api-server test && pnpm --filter studio test` (api-server needs `DATABASE_URL="postgresql://shubhamkr@localhost:5432/nos_dev"` inline). e2e_accuracy only if Python changed (it won't) — but run it once at the end as the sacred check.

---

## File Structure

**Frontend — map symbology (T1)**
- `artifacts/studio/src/index.css` — new `--demand-*` green tokens; verify `--accent-*` usage.
- `artifacts/studio/src/components/workspace/map/EntityMarkers.tsx` — token unwrap (R3); green bubbles (R1); quintile radius (R2).
- `artifacts/studio/src/components/workspace/map/MapLegend.tsx` — green swatches; 5 quintile reference bubbles + ranges.
- `artifacts/studio/src/components/workspace/map/types.ts` — quintile scale fn (replaces `demandRadius` on the input map).

**Backend — R5 manifest unit (T2)**
- `solvers/*/manifest.json` — `distanceUnit`.
- `lib/dataset-schema/src/index.ts` — `distanceUnit` on `ManifestSchema`.
- `artifacts/api-server/src/registry/modelRegistry.ts` — expose it; `lib/api-spec/openapi.yaml` + codegen **only if** `ModelInfo` surfaces it to the client.

**Frontend — tabs / dialogs / Workspace**
- `components/workspace/tabs/ServiceStatsTab.tsx` (R9), `SolveDialog.tsx` (R5), `tabs/CostSummaryTab.tsx` (R6+R8), `tabs/OutputMapTab.tsx` + `components/NetworkMap.tsx` (R7), `tabs/InputMapTab.tsx` (R4), `pages/Workspace.tsx` (R4/R5/R6+R8/R7 wiring).

**Tests** per package; Playwright `artifacts/studio/e2e/`.

---

## Waves

| Wave | Tasks (parallel within) | Gate |
|------|-------------------------|------|
| 1 | T1 symbology (R1/R2/R3) · T2 R5-manifest · T3 R9-label | Checkpoint 1 |
| 2 | T4 R5-SolveDialog · T5 R6+R8-compare | Checkpoint 2 |
| 3 | T6 R4 + R7 (Workspace hub — **after T5**, shares Workspace.tsx) | Checkpoint 3 |
| 4 | T7 QA + live Playwright e2e | Final |

---

## Task T1 — Input Map symbology: token fix (R3) + green demand (R1) + quintile bubbles (R2)

**Role:** frontend-engineer. **Files:** `index.css`, `map/EntityMarkers.tsx`, `map/MapLegend.tsx`, `map/types.ts` + their tests.

- [ ] **Step 1 — R3 token bug (do first).** In `EntityMarkers.tsx` (`warehouseTriangleSvg`, `customerBubbleSvg`) replace every `hsl(var(--accent-NNN))` with `var(--accent-NNN)` (the tokens are already complete `hsl(...)` colors — `index.css:420-425`). For `--muted-foreground`, confirm whether it's a channel token (stays `hsl(var(...))`) or a complete color (unwrap). Add a unit test asserting the generated SVG string contains `var(--accent-700)` and **not** `hsl(var(--accent-700))`. (The "actually paints" proof is Playwright, T7.)
- [ ] **Step 2 — R1 green tokens.** In `index.css`, add `--demand-300` / `--demand-600` (and any needed step) as **complete colors** using the same relative-color pattern as `--accent-*` — a muted green sibling (pick HSL near the accent's saturation/lightness; document the values). In `EntityMarkers.customerBubbleSvg`, when `modelId === "p-median-us"` use `var(--demand-300)` fill / `var(--demand-600)` stroke; else keep accent. Thread `modelId` (or a `demandColor` prop) into `EntityMarkers`. `MapLegend` demand swatches use the same green for p-median-us.
- [ ] **Step 3 — R2 quintile scale.** In `types.ts` add `makeQuintileRadius(demands: number[]): (d: number) => number` implementing the spec's deterministic algorithm: sort ascending; compute p20/p40/p60/p80 by linear-interpolation-between-ranks (type-7); bucket by lower-inclusive `[·]` / upper-exclusive, on-threshold→lower; 5 fixed radii (e.g. `[5,8,11,14,17]`); expose the thresholds + which radii are actually used (for the legend + collapse). Handle `<5` distinct demands / single customer without crashing. **Excluded customers are not in `demands`.** Replace `demandRadius` usage on the input map with a scale built from the current scenario's participating customer demands (passed from the caller — EntityMarkers takes the prebuilt scale fn or the demands array).
- [ ] **Step 4 — legend.** `MapLegend` renders 5 (or fewer, collapsed) reference bubbles at the quintile radii, each labeled with its demand range from the thresholds.
- [ ] **Step 5 — tests + commit.** Unit: R3 SVG syntax; quintile bucketing (boundary, excluded-omitted, degenerate, collapse); green applied only for p-median-us. RTL: EntityMarkers renders green bubbles for p-median-us / accent for another model; legend shows the quintile rows. `pnpm --filter studio test EntityMarkers MapLegend demandScale statusPresentation` + typecheck. Commit `[T1] input-map symbology: token fix (R3) + green demand (R1) + quintile bubbles (R2)`.

## Task T2 — R5 backend: distance-unit manifest metadata

**Role:** backend-engineer. **Files:** `solvers/*/manifest.json`, `lib/dataset-schema/src/index.ts`, `registry/modelRegistry.ts` (+ `openapi.yaml`/codegen only if surfaced) + tests.

- [ ] **Step 1.** Add `distanceUnit: z.enum(["mi","km"]).optional()` to `ManifestSchema` (`lib/dataset-schema/src/index.ts`). Default absent → treat as `"mi"`.
- [ ] **Step 2.** Set `distanceUnit` in each `solvers/<id>/manifest.json`: `"mi"` for `p-median-us`/`p-median-brazil`/`transport-coal`, `"km"` for `two-echelon-gold-au`. (Verify two-echelon's UI actually reports km — the spec's review note; if it's mi, set mi.)
- [ ] **Step 3.** Ensure `modelRegistry.ts` surfaces `distanceUnit` on the model record. If `GET /api/models` (`ModelInfo`) should expose it to the client (T4 reads it), add it to `openapi.yaml`'s `ModelInfo` and regenerate codegen (spec+codegen same commit). If the frontend can read it another already-exposed way, skip the OpenAPI change — decide by how T4 needs it (prefer the manifest already flowing through `useListModels`).
- [ ] **Step 4 — tests + commit.** dataset-schema test: manifest with/without `distanceUnit` validates; a manifest test asserts each model's unit. `pnpm --filter @workspace/dataset-schema test` + api-server registry test + typecheck. Commit `[T2] add distanceUnit manifest metadata (R5)`.

## Task T3 — R9 Service Stats label

**Role:** frontend-engineer. **Files:** `tabs/ServiceStatsTab.tsx` + test.

- [ ] **Step 1.** Label the chart **"Percent of demand served within the selected distance bands"** (title or y-axis, whichever is clearer). Label-only, no metric/logic change (`bandCoverage[].percent` is demand-weighted — do NOT recompute).
- [ ] **Step 2 — test + commit.** RTL asserts the exact label text is present. `pnpm --filter studio test ServiceStats` + typecheck. Commit `[T3] Service Stats label (demand-weighted, R9)`.

## Task T4 — R5 frontend: distance bands in Run Optimizer

**Role:** frontend-engineer. **Depends on:** T2. **Files:** `SolveDialog.tsx`, `pages/Workspace.tsx` (bands prop wiring) + tests.

- [ ] **Step 1.** `SolveDialog` gains a distance-band range editor, two-way synced with `inputs.distanceBands` exactly as `gap`/`p` already sync (read `SolveDialog.tsx` for the pattern). Reuse the existing bands-editor UI component if one exists in the codebase; else a minimal comma/stepper editor. Prefill from the scenario's `inputs.distanceBands` (default = manifest default). The label shows the model's unit from T2 (via `useListModels`/the model record).
- [ ] **Step 2.** On solve, the edited bands persist to `inputs.distanceBands` **before** enqueue — the dialog already does save-then-solve; ensure bands ride that save. They remain the same field editable in Optimization Parameters (one source of truth — no separate state).
- [ ] **Step 3 — tests + commit.** RTL: editing bands in the dialog + solving includes the new `distanceBands` in the saved inputs (assert the mutate payload); the unit label matches the model. `pnpm --filter studio test SolveDialog Workspace` + typecheck. Commit `[T4] pre-solve distance bands in Run Optimizer (R5)`.

## Task T5 — R6+R8: Solution Summary multi-scenario compare

**Role:** frontend-engineer. **Files:** `tabs/CostSummaryTab.tsx`, `pages/Workspace.tsx` (compare wiring) + tests. **Workspace hub — Wave 2.**

- [ ] **Step 1 — selection.** In the Solution Summary surface, add a **scenario toggle list** (checkboxes) of the **current model's** scenarios (from the scenarios query, filtered by modelId). Only **solved + non-stale** scenarios are enabled; unsolved/stale render disabled with a "solve first" hint. Enforce 2–4 selected for compare.
- [ ] **Step 2 — data.** For the selected scenarios, read each one's **latest persisted `result`** (via `useGetScenario`/the scenarios list — each row carries `result`; a small batch of `getScenario` queries is fine, decide N-queries vs one). Do NOT resurrect `POST /scenarios/compare`. While the active scenario is browsing session result-history (a non-latest `displayedResult`), **disable the compare toggles** with a hint to return to latest.
- [ ] **Step 3 — view.**
  - 1 selected → today's single-scenario `CostSummaryTab` (unchanged, incl. its Download CSV).
  - 2–4 → a side-by-side table: columns = scenarios (selection order), rows = **scalar** metrics — objective, open-warehouse count, weighted-avg distance, **aggregate warehouse utilization** (one scalar/scenario, e.g. mean of `utilizationByNode[].utilization` over that scenario's open warehouses — NOT per-facility), scalar service-stats numbers. **Per-band coverage rows** appear **only when all selected scenarios share identical band boundaries** (compare band-for-band); if bands differ, replace those rows with a note listing each scenario's own bands. **Download CSV hidden** in compare mode.
- [ ] **Step 4 — tests + commit.** RTL: only solved/non-stale selectable; cross-model impossible; 1 vs 2–4 rendering; scalar rows correct per column; identical-bands → per-band rows, differing-bands → note; history-browsing disables toggles; CSV hidden in compare. `pnpm --filter studio test CostSummary Workspace` + typecheck. Commit `[T5] Solution Summary multi-scenario compare, no baseline (R6+R8)`.

## Task T6 — R4 (Save in Layers row) + R7 (output map hides closed WHs)

**Role:** frontend-engineer. **Depends on:** T5 (shares `Workspace.tsx`) — run **after** T5. **Files:** `tabs/InputMapTab.tsx`, `tabs/OutputMapTab.tsx`, `components/NetworkMap.tsx`, `pages/Workspace.tsx` + tests.

- [ ] **Step 1 — R4.** On the Input Map tab only, render the Save control + dirty indicator inline in the layer-toggle (`Layers:`) row. Reuse the existing save handler/state; the Workspace toolbar Save for the Input Map tab moves here (other tabs unchanged). Layout-only.
- [ ] **Step 2 — R7 effective output dataset.** In `Workspace.tsx`, build an **effective output dataset** = base dataset ∪ this scenario's added warehouses/customers (current coords) — reuse/adapt the Input Map's effective-row projection. Pass it to `OutputMapTab`/`NetworkMap` instead of the raw base dataset, so added open warehouses and added-customer route endpoints resolve.
- [ ] **Step 3 — R7 opened-only filter.** In `NetworkMap`/`OutputMapTab` output rendering, render **only** warehouses the solver opened (edge `fromId` / `openWarehouseIds`) + their routes; closed candidates not drawn. Customers unchanged. p-median-us first (other models' output unchanged).
- [ ] **Step 4 — tests + commit.** RTL: R4 Save in the Layers row on Input Map, still in the toolbar elsewhere; R7 output map excludes a closed candidate, **includes an added warehouse that was opened + its route to an added/base customer**. `pnpm --filter studio test InputMapTab OutputMap NetworkMap Workspace` + typecheck. Commit `[T6] Save in Layers row (R4) + output map hides closed WHs over effective dataset (R7)`.

## Task T7 — QA: integration + live Playwright e2e

**Role:** qa-sdet. **Depends on:** T1–T6 merged. **Files:** extend `e2e/input-map-v2.spec.ts` or new `e2e/workspace-ux-r1-r9.spec.ts`; RTL as needed.

- [ ] **Step 1 — full gate** on merged state: typecheck, api-server, studio all green; **`e2e_accuracy.py` 87/87** (sacred; no Python changed).
- [ ] **Step 2 — live Playwright** (dev servers per CLAUDE.md recipe; disposable scenario cleaned up): money-path still works; **R3 — outline + dashed warehouse markers actually paint** (browser computed style / screenshot assertion, not jsdom); **R2** bubbles visibly stepped; **R1** demand bubbles green; **R5** set bands in Run Optimizer → solve uses them; **R6+R8** select 2–4 solved scenarios → side-by-side scalar compare, unsolved disabled; **R7** output map shows only opened WHs incl. an added one; **R4** Save in the Layers row; **R9** label present. Report real defects, don't paper over; clean up dev servers + disposable data.
- [ ] **Step 3 — commit** `[T7] R1-R9 QA — integration + live Playwright e2e`.

---

## Self-review checklist (controller, before merge)

- [ ] Full gate green on merged state; `e2e_accuracy.py` 87/87 unchanged.
- [ ] Live Playwright: all R1–R9 verified, R3 markers proven to paint in a real browser.
- [ ] No solver/dataset change (`git diff` shows zero `solve.py`/`solvers/*/dataset/*.json`); only R5's `manifest.json` distanceUnit + schema.
- [ ] Token convention consistent (no `hsl(var(--complete-color))` left anywhere).
- [ ] Other models' maps/output visually unchanged (p-median-us scope held).
- [ ] Merge to local main; push + Render deploy (Bundle 1's deploy step) after user go-ahead.
