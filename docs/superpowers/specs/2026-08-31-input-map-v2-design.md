# Input Map v2 — Map-First Editing (Design Spec)

**Date:** 2026-08-31
**Status:** Approved for planning
**Source docs:** `/Users/shubhamkr/Downloads/SCND_Input_Map_UIMockup/` — `Input Map Design Doc.dc.html` (spec), `Input Map v2.dc.html` (annotated wireframes), `input-map-mockup.html` (runnable D3 reference), `styles.css` (Industry design system).
**Builds on:** SCN v0.3 Phase 3.2 Task 4 (the current click-to-place `InputMapTab.tsx`) and Phase B (scenario-local network edits: `addedWarehouses`/`addedCustomers`/`distanceOverrides`, the `precheck.ts` service, `merge_inputs.py`).

---

## 1. Summary

The Input Map becomes the **primary editing surface** for network inputs, not just a viewer. A student sees supply and demand at a glance through symbology (status triangles, demand-scaled bubbles), inspects any entity with a left-click, and creates, edits, moves, copies, or deletes entities directly on the map through dialogs. Every geographic edit round-trips to the input grids and marks outputs stale on Save.

This spec covers the **p-median-us pilot** in full docs scope. The other three models (`p-median-brazil`, `transport-coal`, `two-echelon-gold-au`) are an explicit fast-follow, out of scope here (§10).

## 2. Governing decisions (locked in brainstorming)

| # | Decision | Rationale |
|---|----------|-----------|
| D1 | **Added-only editability** (DD-1 holds). Base entities: inspect + Edit (writes existing `warehouseOverrides`/`customerOverrides`) + Copy-from. **No move, no delete, no id-change on base.** Added entities: full edit/move/copy/delete. | The base dataset JSON is immutable (DD-1). The data model has no concept of "delete/relocate a base row"; it only has per-id overrides. Move/delete apply only to scenario-local added rows. |
| D2 | **p-median-us pilot first**; other 3 models fast-follow. | Matches the mockup 1:1; lowest risk; same cadence as Phase C. |
| D3 | **Auto-haversine distances on Save**, marked **`estimated`** (soft-warn: solvable immediately, flag clears to confirmed when the student edits the value). | The whole point of map-first editing is "one field to create." Straight-line is a reasonable seed for a hypothetical new site; the estimate flag makes the approximation honest and reviewable. |
| D4 | **Full docs interaction scope** for the pilot. | User decision. |
| D5 | **react-leaflet** (divIcon SVG markers), not the mockup's D3/`geoAlbersUsa`. | §5 explains in full. |
| D6 | **Bundled offline US gazetteer** (~1k public-domain cities); forward (city+state→lat/lng) and reverse (lat/lng→nearest city/state). | Docs resolved this ("offline, instant, no rate limits in the classroom"). Frontend-only. |
| D7 | Added-entity ID scheme `WH-STATE-CITY-SEQ` / `CS-STATE-CITY-SEQ`, seq-bump on collision. **Base keeps its textbook IDs** (`WH23`, `ATL`, …). | Two ID vocabularies coexist; only added IDs ever regenerate (on move). Base IDs never change, so no downstream re-key of base rows. |

## 3. Symbology

- **Supply (warehouses):** triangles, differentiated by status — **filled** (accent-700) = Active/Fixed-Open; **outline** (accent-700 stroke) = Potential; **dashed grey** (neutral-500) = Inactive. Inactive hidden by default; a "Show inactive" toggle reveals them.
- **Demand (customers):** circles ("bubbles"), radius on a **`scaleSqrt`** so area tracks demand (fill accent-300 @ 55%, stroke accent-600). Legend fixes three reference sizes (5k / 15k / 30k units).
- **Layer toggles:** Warehouses on/off, Customers on/off, Show inactive.
- **Legend** overlay bottom-right: the three status swatches + the three reference bubbles.

Status vocabulary is display-only mapping (DD-6, from Phase B): stored enum `active`/`forced_open`/`inactive` ↔ labels **Potential / Fixed-Open / Inactive**. One mapping constant, already exists in `WarehouseTable.tsx`; reuse it.

## 4. Interaction model

| Gesture | Behavior |
|---------|----------|
| Hover marker | Small ID tooltip (`bindTooltip`). |
| Left-click marker | Read-only **details card** near the marker (React overlay): ID, city, state, lat, lng, capacity+status (warehouse) or demand (customer). One card at a time; click-away dismisses. |
| Right-click **base** marker | Action menu: **Edit… / Copy**. (No Move/Delete — D1.) |
| Right-click **added** marker | Action menu: **Edit… / Move / Copy / Delete**. Delete confirms with one extra click inside the menu. |
| Right-click empty space | Context menu: "Add warehouse here / Add customer here" at the clicked coordinates. |
| "+ Add on map" | Arms pin-point mode with a Warehouse/Customer toggle; next map click drops the pin and opens the create dialog. (Enhances Task 4's existing pin flow.) |
| Drag **added** marker | Move (from action menu) or Copy (drags a ghost). Base markers are not draggable. |

Touch out of scope. Details card and action menu are **React overlays positioned over the Leaflet container**, not Leaflet `Popup`s — a `Popup` nested in a `Marker` stays closed until the marker is clicked (documented repo gotcha), which would break the right-click menu.

## 5. Map technology — react-leaflet (D5, in full)

The mockup is a D3 prototype (`d3.geoAlbersUsa()`, topojson outline, no basemap, no real pan/zoom, `localStorage` state). The app's real maps are all **react-leaflet** (`NetworkMap.tsx`, `OutputMapTab.tsx`, `BrazilMap`, the current `InputMapTab.tsx`), with tiled basemaps, native pan/zoom, per-model `getMapBoundsProps()` from the manifest, and the `key`-on-resolved-bounds remount fix.

**Leaflet wins because:**
1. **Consistency** — Input Map and Output Map are one tab apart; two engines = two projections/zoom feels and double the maintenance.
2. **Real basemap** — tiles under the pin; `geoAlbersUsa` is a bare outline.
3. **Multi-model for free** — the fast-follow needs Brazil/Australia; `geoAlbersUsa` is US-only by construction and cannot project them. Leaflet + `countryBounds` already handles all four.
4. **Reuse** — lat/lng↔pixel, bounds, click-to-latlng, the remount fix are already solved in Leaflet; D3 restarts from zero.
5. **The pin flow is already Leaflet** (Task 4).

**Feasibility — Leaflet does everything the mockup shows:**

| Mockup (D3/SVG) | Leaflet equivalent |
|---|---|
| Status triangles | `L.divIcon` with inline SVG `<polygon>`, class per status |
| Demand bubbles (`scaleSqrt` radius) | divIcon `<circle>` |
| Hover ID | `marker.bindTooltip` |
| Left-click card / right-click menu | React overlay on `click`/`contextmenu` |
| Drag Move/Copy | native `L.marker({draggable:true})` + `dragend` |

**Deliberate deviation:** render **all** markers as divIcon SVG (not `L.circleMarker`), uniformly. `circleMarker` is not draggable; `L.marker` is, and Move/Copy need drag. A same-shape SVG circle in a divIcon gives both the bubble look and native drag. Minor perf cost at 200 customers, in line with the ~130ms table measurement from D1.2; revisit only if it janks.

The mockup's JS is a **reference implementation, not code to lift**: we port the *behavior* (symbology rules, id scheme, gazetteer, drag→confirm) onto Leaflet + React. `gazetteer.ts`/`entityId.ts` are near-direct ports of the mockup's `GAZ`/`nearestCity`/`mkId`; rendering is Leaflet-native.

## 6. Data model & backend

### 6.1 Schema change (the only one)

`artifacts/api-server/src/validation/inputs/pMedian.ts` — `distanceOverrideSchema` gains one optional field:

```ts
const distanceOverrideSchema = z.object({
  fromId: z.string().min(1),
  toId: z.string().min(1),
  distance: z.number().positive(),
  estimated: z.boolean().optional(), // NEW — true iff auto-filled haversine, not yet reviewed
});
```

`estimated` is **UI metadata only**. The solver never reads it. `merge_inputs.py`/`solve.py` are **unchanged**, so `e2e_accuracy.py` is untouched (added entities never appear in the textbook ground-truth scenarios). Existing scenarios without the field still validate (optional). `addedWarehouseSchema`/`addedCustomerSchema` already carry `{id,city,state,lat,lng,...}` from Phase B — no change.

**No OpenAPI/codegen change.** `inputs` is an opaque `object` in `openapi.yaml` (D0.1); `distanceOverrides` and its shape live only in the backend Zod validator (`pMedian.ts`) and the frontend's own TS types — never in the generated contract. Adding `estimated` touches `pMedian.ts` + the frontend TS type for a distance-override row, and nothing under `lib/api-zod`/`lib/api-client-react`.

### 6.2 Auto-distance service

New `artifacts/api-server/src/services/autoDistance.ts`:

- `fillEstimatedDistances(inputs, dataset) → inputs'` — for every **active added-involving** pair (added-wh↔active-customer, active-wh↔added-customer, added↔added) that has **no** `distanceOverrides` row, inject `{fromId, toId, distance: haversineMiles(a, b), estimated: true}`. Coordinates come from the base dataset (base entities) and `inputs.addedWarehouses`/`addedCustomers` (added entities). "Active" reuses `precheck.ts`'s existing `buildActivePMedianIds`.
- Idempotent: a pair that already has an override (estimated or manual) is left alone. A manually-edited row (`estimated` absent/false) is never overwritten.
- Units: **miles** (p-median-us base distances are textbook road miles; haversine-miles is the consistent approximation for new pairs).

**When it runs:** on the scenario-inputs **Save path** (`PATCH /scenarios/:id`, and the map-edit apply paths that already write `inputs`), so the estimated rows are **persisted** and therefore visible/editable in the Distances grid — required by the soft-warn/review decision (D3). Not computed transiently at solve time.

`precheck.ts` is unchanged in logic but now rarely reports `completeness` errors post-Save (rows are auto-filled). It remains the guard for the pre-Save/edge cases.

### 6.3 What the backend does NOT do

No gazetteer, no ID generation (frontend owns both — it already has the added-entity list and base dataset in memory). No base-dataset mutation. No solver change.

## 7. Frontend

### 7.1 New libs

- `artifacts/studio/src/lib/gazetteer.ts` + bundled `gazetteer-us.json` (~1k US cities: `{city, state, lat, lng}`, public-domain source — SimpleMaps basic / GeoNames US). Two ops:
  - `nearestCity(lat, lng) → {city, state}` — reverse, nearest by squared-degree distance (mockup's `nearestCity`).
  - `lookupCity(city, state) → {lat, lng} | null` — forward, for the grid-mirror flow.
- `artifacts/studio/src/lib/entityId.ts` — `nextEntityId(kind, state, city, existingIds) → "WH-TX-DALLAS-01"`. `cityCode` = uppercase, non-alpha stripped; seq = lowest 2-digit not colliding with base+added ids for that city (mockup's `mkId`/`nextId`). Base IDs are part of `existingIds` so a new added id never collides with a base id.

### 7.2 Input Map rewrite (`InputMapTab.tsx`)

Absorbs Task 4's pin flow and adds: symbology (§3), layer toggles, legend, hover tooltip, left-click details card, right-click action menus (base vs added, §4), right-click-empty add menu, drag Move/Copy. Consumes the current scenario's `inputs` + base dataset; writes through the existing Workspace manual-Save path.

### 7.3 Dialog components (new)

- `EditWarehouseDialog` — ID/city/state/lat/lng read-only; **Capacity** (when `capacityMode==="per_wh"`) + **Status** (Potential/Fixed-Open/Inactive radio) editable. Base → writes `warehouseOverrides`; added → mutates the `addedWarehouses` row.
- `EditCustomerDialog` — **Demand** via slider + number input; the map bubble previews the new size live while dragging. Base → `customerOverrides`; added → row. New customers default to **median** customer demand.
- `MoveConfirmDialog` (added only) — shows new lat/lng, reverse-geocoded city/state, and the **regenerated ID** (`old → new`). On confirm: mutate the added row (`id/city/state/lat/lng`); its old `distanceOverrides` are **cleared** (stale — location changed) and re-filled as `estimated` on the next Save (§6.2). Any `warehouseOverrides`/`customerOverrides` row keyed to the old id is re-keyed to the new id. Cancel snaps back.
- `CreateEntityDialog` — pin/copy → auto ID + closest city/state (reverse-geocoded, editable if wrong), lat/lng from pin. Only capacity/status (warehouse) or demand (customer) is typed. Copy prefills the source's capacity/demand as a starting value; **Copy source may be base or added** (Copy never mutates the source; the result is always a new *added* row).

### 7.4 Grid mirror (Warehouses / Customers tabs)

The "Add row" forms gain the mirror flow: type **City + State** → on blur, `lookupCity` fills lat/lng and `nextEntityId` fills the ID; auto-filled cells render grey until touched, editable on click.

## 8. Consistency rules

- **Stale rule:** every map edit (status, capacity, demand, move, copy, create, delete) marks the scenario stale on Save — Output Map, Solution Summary, and output grids clear until re-solve. (Existing X1.1 staleness; the map edits route through the same Save path.)
- **Estimate toast (replaces the old "missing N distances" toast):** after Save, per new/moved entity, toast **"N distances estimated for `<id>` — review"** with a jump-to-Distances action scrolled to those rows. (Post-auto-fill there are no *missing* rows; there are *estimated* rows to review.) Reuses Task 4's two-step precheck timing (toast fires after the awaited post-Save fetch, keyed to the saved state).
- **Estimated rows in the Distances grid:** tinted/badged "estimated"; editing a row's value clears its `estimated` flag → "confirmed". This is the review affordance the soft-warn decision requires.
- **Grid parity:** map and input grids are two views of the same `inputs`; an edit on either side is immediately visible on the other.

## 9. Testing strategy

- **Backend (vitest):** `autoDistance.ts` — haversine correctness (hand-checked mi for a known city pair), only added-involving pairs filled, existing/manual rows untouched, idempotency, `estimated:true` on filled rows only. `pMedian.test.ts` — `estimated` field accepted/optional. Precheck unaffected.
- **Solver (pytest):** none required (no Python change). `e2e_accuracy.py` re-run only as the standing safety check; expected 87/87 unmodified.
- **Frontend (RTL):** `gazetteer.ts` (forward/reverse), `entityId.ts` (seq-bump, base-collision), each dialog (edit base→override vs added→row, move id-regen + distance clear, create auto-populate, copy from base and added), symbology status→style, layer toggles, estimated-row tint + confirm-on-edit, the estimate toast.
- **e2e (Playwright):** the money path — add a warehouse on the map → dialog auto-populates ID/city → save → estimate toast → open Distances, see estimated rows → edit one (confirms) → Run Optimizer solves. Plus a move: drag an added marker → confirm regenerated ID → distances re-estimated.

## 10. Out of scope / fast-follow

- **Other 3 models.** `p-median-brazil` (no `GET /dataset` for its frontend — same carve-out as Phase B), `transport-coal`, `two-echelon-gold-au`. Each needs its own entity mapping onto triangles/bubbles and its own gazetteer coverage (Brazil, Australia).
- **`transport-coal` auto-distance — well-defined (corrected):** despite the `laneCostOverrides` name and the `costs.json` filename, transport-coal's lane values are **distances in miles** (`_transport_distances()` docstring: "haversine × circuity"); the objective minimizes **ton-miles** (`sum(distance × flow)`) and `avg_dist = obj / total_demand` is weighted-average miles. So auto-haversine is **well-defined for transport-coal too**, same as p-median — the fast-follow just applies the same haversine-miles fill to `laneCostOverrides`. One nuance: base lanes carry a **circuity** multiplier, so a raw-haversine estimate lands ~10–20% under base scale; acceptable as a labeled estimate, or apply a nominal circuity factor (decide in the fast-follow plan). The genuinely non-geometric objective is **two-echelon**'s (divided by `TRUCKLOAD_KG` → truckload-miles, must not be demand-divided) — that model's auto-fill needs more care. The pilot is p-median-us only regardless.
- **Base entity move/delete** (contradicts D1/DD-1) — not built; base "removal" is expressed as setting the entity Inactive via Edit.
- Touch gestures; marker clustering beyond nearest-hover.

## 11. Risks & mitigations

| Risk | Mitigation |
|------|-----------|
| Auto-fill silently mutating user `inputs` on Save feels surprising | The estimate toast + grid tint make every auto-filled row visible and labeled; nothing is hidden. Idempotent + never overwrites a manual value. |
| Move re-keying corrupts distances if an override row is missed | Move **clears** the moved entity's `distanceOverrides` rather than re-keying stale values; auto-fill regenerates them as estimated. Simpler and can't leave a wrong number keyed to a new location. |
| 200 draggable divIcon markers jank | Measured precedent (~130ms, D1.2). Only added markers are draggable; base bubbles are lighter. Revisit with virtualization only if measured jank. |
| Gazetteer coverage gaps (a click far from any listed city snaps to a distant name) | ~1k-city gazetteer is ample for a US teaching tool; the reverse-geocoded city/state is **editable** in every create/move dialog if the lookup is wrong (docs' own escape hatch). |
| Two ID vocabularies (textbook base ids + `WH-STATE-CITY-SEQ` added ids) confuse | Base ids never regenerate; only added ids follow the new scheme; the precheck already guards collisions across both spaces. |

## 12. Design system

All new surfaces follow the **Industry** design system already applied to the Workspace as `.scn-theme` (Phase 3.1): steel-blue accent ramp, Barlow / Barlow Condensed, 0-radius blueprint frames, `+` registration corners on cards/dialogs, the single solid accent "Run Optimizer" button, 2px accent focus ring, Lucide icons. Map symbology draws only on the accent ramp (no second accent, no red — stale/destructive states use accent-800/900). New components (details card, action menus, dialogs, legend, toasts) reuse the system's card/dialog/table/button classes.
