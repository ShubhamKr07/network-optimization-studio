# Non-JADE ServiceStats live coverage — Design Spec

**Date:** 2026-09-18 · **Base:** `main` (`d38361b`, post-JADE-bundle) · **Status:** approved (scope + design confirmed).
**Follow-up of:** JADE Ch.9 Workspace bundle spec §12 (deferred item).

## 1. Problem

The JADE bundle made distance bands a **live lens** for map lanes across ALL models (#1: Output Map `bands` fed from live `localInputs`, non-staling band save). But `ServiceStatsTab`'s coverage **bars** recompute live **only for JADE** (`ServiceStatsTab.tsx:181-191`, gated on `supportsPlantProductCapability`); every other model reads the **frozen** `result.metrics.bandCoverage`. So `p-median-us` / `p-median-brazil` / `transport-coal` / `two-echelon-gold-au` now have a visible inconsistency: editing bands recolors the map but not the ServiceStats bars.

## 2. Decision (approver-confirmed)

Make the coverage bars **live** for the **4 distance-band models** — `p-median-us`, `p-median-brazil`, `transport-coal`, `two-echelon-gold-au` — consistent with the map and JADE. **`chens-cosmetics-cn` stays frozen** (its "coverage" is a special min-distance concept: a synthetic 2-row `bandCoverage` at `solve.py:1281` + a derived band editor — the distance-band recompute doesn't apply). This **reverses** `ServiceStatsTab`'s deliberate "frozen = what the solve achieved" intent for those 4 models (line 124 comment), turning ServiceStats into a live lens everywhere except chens — an explicit, accepted trade-off for cross-surface consistency.

## 3. Semantics (verified compatible)

- The solver's `metrics.bandCoverage` is **cumulative** (`solve.py`: `if dist <= b: band_demand[b] += demand`, per boundary) — matches the client `computeCumulativeBandCoverage` (each boundary counts all flow ≤ it + a `-1` overflow row). So at solve-time bands the bars are unchanged **except**: the single-echelon solvers (us/brazil/transport, `solve.py:356/523/704`) **omit** the overflow row, while the client recompute **adds** an explicit `> maxBoundary` overflow row. Accepted (arguably more correct; ServiceStats already renders the `-1` row).
- Two-echelon solvers (gold-au `:905`, jade `:1181`) already emit the `-1` row.

## 4. Implementation

### 4a. `ServiceStatsTab.tsx`
- **Generalize the live-coverage gate:** replace `useLiveCoverage = supportsPlantProductCapability && presentationBands != null && length>0` with `useLiveCoverage = presentationBands != null && presentationBands.length > 0`. (Model-selection moves to the caller — INT passes `presentationBands` only for the 5 live models, never chens — so the gate is just "is it wired".)
- **Per-model service-edge selection:** replace the JADE-only `outboundEdges = edges.filter(e => e.leg === "warehouse_to_customer")` with a general `serviceEdges`:
  - if any edge carries a `leg` (two-echelon: jade/gold-au) → filter to the OUTBOUND/demand-serving leg via `isOutboundLeg` (from `lib/legPalette.ts`, `OUTBOUND_LEGS = {refinery_to_customer, warehouse_to_customer}`);
  - else (single-echelon: us/brazil/transport — edges have no `leg`) → **all** edges.
  - `bandCoverage = useLiveCoverage ? computeCumulativeBandCoverage(serviceEdges, presentationBands) : (result.metrics.bandCoverage ?? [])`.
- Plant Production section unchanged (still `supportsPlantProductCapability`-gated, JADE-only).
- Update the line-124/130 comments to reflect the generalization (was JADE-only).

### 4b. `Workspace.tsx`
- Pass `presentationBands` (= live `distanceBandsFromInputs(localInputs)`, the same value already fed to the Output Map) to `ServiceStatsTab` for **every model except `chens-cosmetics-cn`**. Today INT wires it only on the JADE branch; extend to the shared/other-model ServiceStats render path, gated `modelId !== "chens-cosmetics-cn"`.

### 4c. No backend / solver / dataset change
Frontend-only. `e2e_accuracy.py` not run.

## 5. Tests
- `ServiceStatsTab.test.tsx`: (a) a single-echelon model (no `leg` edges) with `presentationBands` recomputes live over ALL edges + shows the overflow row when out-of-range flow exists; (b) `two-echelon-gold-au` recomputes over `refinery_to_customer` edges ONLY (an inbound `mine_to_refinery` edge is excluded); (c) an edited boundary reclassifies the bars with no network call; (d) **chens stays frozen** — with coverage KPIs present it reads `result.metrics.bandCoverage` even if `presentationBands` were passed (belt-and-suspenders, though INT won't pass it); (e) JADE unchanged (still W→C only).
- `Workspace` RTL: `presentationBands` passed to ServiceStats for a non-JADE distance-band model, and NOT passed for chens.

## 6. QA (real browser)
Edit bands post-solve on `p-median-us` (single-echelon) and `two-echelon-gold-au` (two-echelon): ServiceStats coverage bars re-bucket live with **no** `/solve` call; the map and bars now agree. Confirm `chens-cosmetics-cn` bars do NOT change on a band edit (stay frozen).

## 7. Out of scope
- `chens-cosmetics-cn` live coverage.
- Any backend/solver change.
