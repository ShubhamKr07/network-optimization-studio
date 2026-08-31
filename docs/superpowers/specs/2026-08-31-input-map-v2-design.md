# Input Map v2 — Map-First Editing (Design Spec)

**Date:** 2026-08-31 (rev. 2 — incorporates review round)
**Status:** Approved for planning
**Source docs:** `/Users/shubhamkr/Downloads/SCND_Input_Map_UIMockup/` — `Input Map Design Doc.dc.html` (spec), `Input Map v2.dc.html` (annotated wireframes), `input-map-mockup.html` (runnable D3 reference), `styles.css` (Industry design system).
**Builds on:** SCN v0.3 Phase 3.2 Task 4 (the current click-to-place `InputMapTab.tsx`) and Phase B (scenario-local network edits: `addedWarehouses`/`addedCustomers`/`distanceOverrides`, the `precheck.ts` service, `merge_inputs.py`).

---

## 1. Summary

The Input Map becomes the **primary editing surface** for network inputs, not just a viewer. A student sees supply and demand at a glance through symbology (status triangles, demand-scaled bubbles), inspects any entity with a left-click, and creates, edits, moves, copies, or deletes entities directly on the map through dialogs. Every geographic edit round-trips to the input grids and marks outputs stale on Save.

This spec covers the **p-median-us pilot** in full docs scope. The other three models (`p-median-brazil`, `transport-coal`, `two-echelon-gold-au`) are an explicit fast-follow, out of scope here (§10).

## 2. Governing decisions (locked in brainstorming + review round)

| # | Decision | Rationale |
|---|----------|-----------|
| D1 | **Added-only editability** (DD-1 holds). Base entities: inspect + Edit (writes existing `warehouseOverrides`/`customerOverrides`) + Copy-from. **No move, no delete, no id-change on base.** Added entities: full edit/move/copy/delete. | The base dataset JSON is immutable (DD-1). The data model has no concept of "delete/relocate a base row"; it only has per-id overrides. Move/delete apply only to scenario-local added rows. |
| D2 | **p-median-us pilot first**; other 3 models fast-follow. | Matches the mockup 1:1; lowest risk; same cadence as Phase C. |
| D3 | **Auto-haversine distances**, marked **`estimated`** (soft-warn: solvable immediately, flag clears to confirmed when the student edits the value). | The whole point of map-first editing is "one field to create." Straight-line is a reasonable seed for a hypothetical new site; the estimate flag makes the approximation honest and reviewable. |
| D4 | **Full docs interaction scope** for the pilot. | User decision. |
| D5 | **react-leaflet** (divIcon SVG markers), not the mockup's D3/`geoAlbersUsa`. | §5 explains in full. |
| D6 | **Bundled offline gazetteer from the US Census Gazetteer (Places) file** — genuinely public domain (US Government work), no attribution burden. Forward (city+state→lat/lng) and reverse (lat/lng→nearest city/state). | Docs resolved offline geocoding ("offline, instant, no rate limits in the classroom"). Census Places is a reproducible, PD source. Frontend-only. |
| D7 | **Stable identity, derived display code.** Every added entity carries an immutable opaque `id` (a generated uid — the join key `distanceOverrides` reference, **never changes**) plus a display-only `displayCode` (`WH-STATE-CITY-SEQ` / `CS-STATE-CITY-SEQ`) shown in the UI, regenerated on move. Base entities keep their textbook id (which is both key and display). | Decouples the join key from location. A move changes only the human label and the entity's coordinates — never the key — so `distanceOverrides`/precheck/`merge_inputs.py` are untouched by identity and cannot be corrupted by a re-key. Backend keeps keying on `id` exactly as Phase B does. |
| D8 | **Estimation is one canonical p-median input-normalization step**, applied by **every** persistence path that can accept added entities (PATCH, POST create, `/import/apply`), followed by schema revalidation. | PATCH-only would leave imported additions with no distances (import-apply marks its result saved, so no later dirty Save would ever fill them). One normalizer, one place, all paths. |
| D9 | **Keyboard: dialogs + action menus fully keyboard-accessible now** (Escape closes, focus trap + restore, tab order); focusable-marker keyboard navigation deferred to the fast-follow. | Covers the standard dialog/menu a11y surface in the pilot without the Leaflet marker-focus machinery. |

## 3. Symbology

- **Supply (warehouses):** triangles, by **stored status** (one canonical mapping, D7 vocabulary): `active` → **outline** (accent-700 stroke) = *Potential*; `forced_open` → **filled** (accent-700) = *Fixed-Open*; `inactive` → **dashed grey** (neutral-500) = *Inactive*. There is **no "Active" fill state** — `active` is Potential and renders as an outline, not a fill. Inactive hidden by default; a "Show inactive" toggle reveals them.
- **Demand (customers):** circles ("bubbles"), radius from a **pure `sqrt` scale on a fixed domain** (see below), fill accent-300 @ 55%, stroke accent-600. A base customer with an **`excluded` override renders dimmed** (low-opacity, visually distinct from active demand) but stays hoverable/left-clickable/editable — the student can Edit it to un-exclude. It is never shown as ordinary active demand (the solver + distance service exclude it).
- **Demand scale:** `radius = R_MAX * sqrt(demand / DEMAND_REF)`, clamped to `[R_MIN, R_MAX]`, where `DEMAND_REF` and `R_MAX` are **fixed constants** (not scenario-relative). Area then tracks demand, and the **legend's fixed 5k/15k/30k reference bubbles use the exact same scale/domain** — the scale function is exported once and consumed by both `EntityMarkers` and `MapLegend`. (`R_MIN` is a small visibility floor; the "area-proportional" claim holds above it.)
- **Layer toggles:** Warehouses on/off, Customers on/off, Show inactive.
- **Legend** overlay bottom-right: the three status swatches + the three reference bubbles.

**One exported presentation mapping.** Stored enum ↔ label ↔ marker style live in a **single exported constant** (e.g. `warehouseStatusPresentation: Record<WhStatus, { label; markerStyle }>`) consumed by `WarehouseTable`, the dialogs, `EntityMarkers`, and `MapLegend`. `WarehouseTable.tsx`'s currently-private `STATUS_LABEL` is extracted into this shared module (label vocabulary unchanged: Potential / Fixed-Open / Inactive).

> **Review question (blocking):** If stored `active` is displayed as **Potential**, should its triangle be the outlined Potential style, with only `forced_open` filled and `inactive` dashed? The current “filled = Active/Fixed-Open” rule introduces an **Active** input status that does not exist and gives `active` two incompatible styles.

> **Review question:** What is the effective map-view rule for scenario overrides—especially a base customer's `excluded` status? Should excluded customers be hidden, dimmed, or separately symbolized and editable so the map does not show them as ordinary active demand while the solver and distance service exclude them?

## 4. Interaction model

| Gesture | Behavior |
|---------|----------|
| Hover marker | Small ID tooltip (`bindTooltip`). |
| Left-click marker | Read-only **details card** near the marker (React overlay): displayCode, city, state, lat, lng, capacity+status (warehouse) or demand (customer). One card at a time; click-away dismisses. |
| Right-click **base** marker | Action menu: **Edit… / Copy**. (No Move/Delete — D1.) |
| Right-click **added** marker | Action menu: **Edit… / Move / Copy / Delete**. Delete confirms with one extra click inside the menu. |
| Right-click empty space | Context menu: "Add warehouse here / Add customer here" at the clicked coordinates. |
| "+ Add on map" | Arms pin-point mode with a Warehouse/Customer toggle; next map click drops the pin and opens the create dialog. (Enhances Task 4's existing pin flow.) |
| Move / Copy (added) | Explicit state machine (§7.4), not raw dragend — arm → drag a ghost to a destination → confirm to commit / Escape to restore. |

**Overlays, not Leaflet Popups.** Details card, action menu, and dialogs are React overlays in a `position: relative` wrapper over the Leaflet container — never a `<Popup>` nested in a `<Marker>` (repo gotcha: stays closed until marker click). Their coordinate + event contract (§7 / plan T5): marker callbacks pass the Leaflet **`containerPoint`** (not raw viewport/DOM coords); the overlay clamps/flips at the container edges; it **closes (or recomputes) on pan/zoom/remount**; and a marker `contextmenu` **stops propagation** so it does not also trigger the empty-space "add here" menu.

**Keyboard (D9).** Dialogs and action menus are fully keyboard-operable in the pilot: focus moves into the overlay on open, is trapped while open, Escape closes and **restores focus** to the invoker, tab order is defined. Focusable-marker navigation (Tab to markers, Enter = details, Menu/Shift+F10 = actions, keyboard-driven move/copy) is an explicit fast-follow (§10). Touch out of scope.

> **Review question:** What are the keyboard equivalents for hover, left-click, right-click, and drag (for example, focusable markers, Enter for details, Shift+F10/Menu for actions, and an explicit move/copy mode)? Touch may be out of scope, but making the primary editor mouse-only would also exclude keyboard users and leaves dialog/menu focus, Escape, and focus restoration undefined.

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
| Status triangles | `L.divIcon` with an SVG **string** `html`, class per status |
| Demand bubbles (`sqrt` radius) | `L.divIcon` SVG `<circle>` string |
| Hover ID | `marker.bindTooltip` |
| Left-click card / right-click menu | React overlay on `click`/`contextmenu` |
| Drag Move/Copy | native `L.marker({draggable:true})` + drag events |

`L.divIcon`'s `html` must be a **string (or HTMLElement)**, not a React `<svg>` element — the marker SVG is built via a static-markup builder (a template string, or `renderToStaticMarkup`), not JSX passed straight into `html`.

**Deliberate deviation:** render **all** markers as divIcon SVG (not `L.circleMarker`), uniformly. `circleMarker` is not draggable; `L.marker` is, and Move/Copy need drag. A same-shape SVG circle in a divIcon gives both the bubble look and native drag. Minor perf cost at 200 customers, in line with the ~130ms table measurement from D1.2; revisit only if it janks.

The mockup's JS is a **reference implementation, not code to lift**: we port the *behavior* (symbology rules, id/displayCode scheme, gazetteer, drag→confirm) onto Leaflet + React.

## 6. Data model & backend

### 6.1 Schema changes

`artifacts/api-server/src/validation/inputs/pMedian.ts`:

- `distanceOverrideSchema` gains `estimated: z.boolean().optional()` (UI metadata; solver ignores it).
- `addedWarehouseSchema` / `addedCustomerSchema` gain `displayCode: z.string().optional()` (D7 — the human label; the existing `id` field remains the **stable join key**, generated as an opaque uid for new added entities). Optional so old scenarios still validate; the frontend always sets it for new adds.

```ts
const distanceOverrideSchema = z.object({
  fromId: z.string().min(1),
  toId: z.string().min(1),
  distance: z.number().positive(),
  estimated: z.boolean().optional(), // true iff auto-filled haversine, not yet reviewed
});
// addedWarehouseSchema / addedCustomerSchema: + displayCode: z.string().optional()
```

`merge_inputs.py`/`solve.py` are **unchanged** (they key on `id`, which never changes; `displayCode`/`estimated` are ignored), so `e2e_accuracy.py` is untouched (added entities never appear in the textbook ground-truth scenarios).

**No OpenAPI/codegen change.** `inputs` is an opaque `object` in `openapi.yaml` (D0.1); these shapes live only in the backend Zod validator (`pMedian.ts`) and the frontend's own TS types — never in the generated contract.

### 6.2 Auto-distance normalization (D8)

New `artifacts/api-server/src/services/autoDistance.ts`, exposed as a p-median **input-normalization step**:

- `fillEstimatedDistances(inputs) → inputs'` — for every **active added-involving** pair (added-wh↔active-customer, active-wh↔added-customer, added↔added) with **no** existing `distanceOverrides` row, inject `{fromId, toId, distance, estimated: true}`. "Active" reuses `precheck.ts`'s `buildActivePMedianIds`.
- **Role-scoped coordinates.** Build **separate** warehouse-coordinate and customer-coordinate maps (base ∪ added, per role) — never one merged `id → coord` map, because IDs are role-scoped (as the precheck/solver already treat them) and a same-string customer id must not overwrite a warehouse coordinate.
- **Distance value:** `haversineMiles(whCoord, custCoord)`, then **clamped to a documented minimum** `MIN_DISTANCE_MI = 0.1` so a coincident/very-near pair can never round to `0` and violate `z.number().positive()`.
- **Idempotent & non-destructive:** a pair that already has a row (manual or `estimated`) is left exactly as-is; a manual value is never overwritten.
- **Revalidate:** the augmented inputs are re-run through the p-median Zod validator before persistence (the normalizer's output must satisfy the same schema its input did).

**Where it runs (D8):** the normalizer is invoked on **every** path that persists p-median inputs and can carry added entities — `PATCH /scenarios/:id`, `POST /scenarios` (create), and `POST /scenarios/:id/import/apply` — gated on `modelId === "p-median-us"`. Not at solve time (the estimated rows must be **persisted**, so they show up editable in the Distances grid — the soft-warn/review affordance, D3).

`precheck.ts` is unchanged in logic but now rarely reports `completeness` errors post-Save (rows are auto-filled). It remains the guard for pre-normalization/edge cases.

### 6.3 What the backend does NOT do

No gazetteer, no ID/displayCode generation (frontend owns both). No base-dataset mutation. No solver change.

## 7. Frontend

### 7.1 New libs

- `artifacts/studio/src/lib/gazetteer.ts` + bundled `gazetteer-us.json` (**US Census Gazetteer — Places**, public domain; committed via a reproducible extraction script + a checksum, filtered to ~1k cities by population; each row `{city, state, lat, lng}`). Two ops:
  - `nearestCity(lat, lng) → {city, state, lat, lng}` — reverse, nearest by **haversine** distance (not squared-degree; a 1k-row haversine scan is cheap and avoids latitude-dependent longitude distortion — reuse the same haversine as the backend's formula).
  - `lookupCity(city, state) → {lat, lng} | null` — forward (case-insensitive exact city+state), for the grid-mirror flow.
- `artifacts/studio/src/lib/entityId.ts`:
  - `newUid(kind: "wh"|"cs") → string` — an opaque stable id for a new added entity (e.g. `crypto.randomUUID()`-based, role-prefixed). This is the **join key** (D7); it never changes.
  - `nextDisplayCode(kind, state, city, existingCodes) → "WH-TX-DALLAS-01"` — the human label; `cityCode` = uppercase, non-alpha stripped; seq = lowest 2-digit not colliding with existing **displayCodes**. Cosmetic only.

> **Review question:** Which exact gazetteer source, version, extraction rule, license, and attribution will be committed through a reproducible script/checksum? Neither cited option is public domain—[SimpleMaps US Cities](https://simplemaps.com/data/us-cities) requires attribution for its free data, and [GeoNames](https://www.geonames.org/export/) is CC-BY—and why use squared-degree “nearest” when a 1,000-row haversine scan is cheap and avoids latitude-dependent longitude distortion?

### 7.2 Input Map rewrite (`InputMapTab.tsx`)

Absorbs Task 4's pin flow and adds: symbology (§3), layer toggles, legend, hover tooltip, left-click details card, right-click action menus (base vs added, §4), right-click-empty add menu, Move/Copy. Consumes an **effective-row projection** (§7.5) of the current scenario's `inputs` + base dataset; writes through the existing Workspace manual-Save path.

### 7.3 Dialog components (new)

Dialogs are **presentational** — they emit a patch/entity; the caller (InputMapTab, plan T8) decides base→override vs added→row. All keyboard-accessible (D9).

- `EditWarehouseDialog` — displayCode/id/city/state/lat/lng read-only; **Capacity** (when `capacityMode==="per_wh"`) + **Status** editable. Base → writes `warehouseOverrides`; added → mutates the `addedWarehouses` row.
- `EditCustomerDialog` — **Demand** via slider + number; `onLivePreview` fires on drag so the parent resizes the map bubble (transient state, rolled back on Cancel). Base → `customerOverrides` (preserving the existing status, or `status:"active"` if none, so the override shape stays valid); added → row. New customers default to **median** demand.
- `MoveConfirmDialog` (added only) — shows new lat/lng, reverse-geocoded city/state, and the **regenerated displayCode** (`old → new`). On confirm: the entity's stable `id` is **unchanged**; only `displayCode`, `city`, `state`, `lat`, `lng` change; the entity's own `distanceOverrides` rows (those whose `fromId`/`toId` equals this entity's `id`) are **cleared** (their values are stale for the new location) and re-filled as `estimated` on the next Save. **No `warehouseOverrides`/`customerOverrides` array is touched** (added-entity values live on the added row; those override arrays belong to base entities and must never be re-keyed). The regenerated displayCode **excludes the entity's own current displayCode** from the collision set (a same-city nudge keeps `-01`, not a spurious `-02`). Cancel snaps back.
- `CreateEntityDialog` — pin/copy → auto displayCode + closest city/state (reverse-geocoded, **editable**; editing city/state **deterministically regenerates** the displayCode so label and location never disagree), lat/lng from the pin (Copy: from the ghost's **destination**, §7.4). Assigns a fresh `newUid` as the stable id. Warehouse: Capacity + Status; Customer: Demand (default = median, or `copyFrom`'s value). **Copy source may be base or added** (never mutates the source; result is always a new added row).

### 7.4 Move / Copy state machine

One explicit machine (not raw `dragend`): **arm** (from the action menu) → a **ghost** marker follows the cursor → **drop** picks a destination lat/lng → **confirm** commits (Move → `MoveConfirmDialog`; Copy → `CreateEntityDialog` seeded with the destination coords + `copyFrom`) → **Cancel/Escape** restores the original marker and discards the ghost. Copy therefore always has a real destination coordinate (the read-only lat/lng in its dialog is the drop point, not the source's).

### 7.5 Effective-row projection

Before rendering markers / details / Edit / Copy, InputMapTab computes one **effective-row projection**: base rows with their scenario overrides applied (status/capacity/demand), unioned with added rows. This single derived view is the source for symbology (an overridden-inactive base warehouse renders dashed; an excluded base customer renders dimmed, §3), for the details card, and for what an Edit dialog pre-fills. Editing a **base** entity writes back the matching override (preserving/supplying a valid `status`); editing an **added** entity writes back its row.

### 7.6 Grid mirror (Warehouses / Customers tabs)

The **`WarehousesTab.tsx` / `CustomersTab.tsx` "Add row" forms** (this is where the add-row UI actually lives — not in `components/tables/*Table.tsx`) gain the mirror flow: type **City + State** → on blur, `lookupCity` fills lat/lng and `nextDisplayCode` fills the displayCode (and `newUid` the hidden id); auto-filled cells render grey until touched, editable on click. If `lookupCity` misses, lat/lng stay blank for manual entry.

## 8. Consistency rules

- **Stale rule:** every map edit marks the scenario stale on Save — Output Map, Solution Summary, and output grids clear until re-solve (existing X1.1; the map edits route through the same Save path).
- **Save reconciliation contract (client).** Because the normalizer (§6.2) runs server-side, a Save **returns augmented `inputs`** (new `estimated` rows) that differ from what the client sent. On success the Workspace **adopts the PATCH/apply response** as both its local draft and its saved snapshot — writing the returned `inputs` into `localInputs`, `savedInputsRef`, and the query cache — so the scenario doesn't immediately re-flag dirty and the estimated rows are visible. The **Input Map tab is added to `isEditableInputTab`** so the manual-Save toolbar (and save-before-solve) are available from the primary editor.
- **Estimate toast.** After Save, per explicit create/copy/move watch, the toast **counts the newly-returned `estimated:true` rows** for that entity (by **diffing** the saved-response `distanceOverrides` against the pre-save set — *not* from precheck, which now finds **zero** missing-distance errors after auto-fill), and reads **"N distances estimated for `<displayCode>` — review"** with a jump-to-Distances action. Reuses Task 4's two-step timing (fires after the awaited post-Save fetch).
- **Estimated rows in the Distances grid:** tinted/badged "estimated"; editing a row's value clears its `estimated` flag → "confirmed".
- **Grid parity:** map and input grids are two views of the same `inputs`; an edit on either side is immediately visible on the other.

> **Review question (blocking):** Since Save will now return server-augmented `inputs`, what is the client reconciliation contract? The Workspace must adopt the PATCH response as both its local and saved snapshot, and the estimate toast must count newly returned `estimated:true` rows for explicit create/move watches; post-fill precheck has zero missing-distance errors and cannot supply that `N`.

## 9. Testing strategy

- **Backend (vitest):** `autoDistance.ts` — haversine correctness (hand-checked mi, generous tolerance), only added-involving pairs filled, existing/manual rows untouched, idempotency, `estimated:true` on filled rows only, **role-scoped maps** (a same-string cross-role id does not cross-contaminate), **zero/near-zero clamp** to `MIN_DISTANCE_MI`, revalidation passes. The normalizer runs on **PATCH, POST, and import-apply** (each asserted). `pMedian.test.ts` — `estimated` + `displayCode` accepted/optional.
- **Solver (pytest):** none required (no Python change). `e2e_accuracy.py` re-run as the standing safety check; expected 87/87 unmodified.
- **Frontend (RTL):** `gazetteer.ts` (forward/reverse, haversine nearest), `entityId.ts` (uid stability, displayCode seq-bump, **exclude-own-code on same-city move**), each dialog (edit base→override with preserved status vs added→row; move regenerates displayCode but keeps id + clears own distances; create auto-populate + city-edit regenerates code; copy from base and added with a real destination coord), symbology status→style via the shared mapping, excluded-customer dimming, layer toggles, estimated-row tint + confirm-on-edit, the estimate toast (N from the returned-row diff), keyboard (Escape/focus-restore on dialogs+menus).
- **e2e (Playwright):** the money path (add → save → estimate toast → Distances estimated rows → edit one confirms → Run Optimizer solves) **plus the move/re-estimate path**, and the Leaflet-only risks mocked RTL can't prove: marker-vs-empty context-menu propagation, ghost Copy destination, Move Cancel/snapback, overlay behavior after pan/zoom, base action-menu gating (no Delete on base), and keyboard menu/dialog access with focus restoration.

## 10. Out of scope / fast-follow

- **Other 3 models.** `p-median-brazil` (no `GET /dataset` for its frontend — same carve-out as Phase B; its input-map tab stays the current placeholder, never the Task-4 map), `transport-coal`, `two-echelon-gold-au`. Each needs its own entity mapping and gazetteer coverage.
- **`transport-coal` auto-distance — well-defined (corrected):** despite the `laneCostOverrides` name and the `costs.json` filename, transport-coal's lane values are **distances in miles** (`_transport_distances()` docstring: "haversine × circuity"); the objective minimizes **ton-miles** and `avg_dist = obj / total_demand` is weighted-average miles. Auto-haversine is **well-defined** there — the fast-follow applies the same fill to `laneCostOverrides`; one nuance is a **circuity** multiplier (raw haversine lands ~10–20% under base scale — acceptable as a labeled estimate, or apply a nominal factor). The genuinely non-geometric objective is **two-echelon**'s (`TRUCKLOAD_KG` → truckload-miles) — that model's auto-fill needs more care. Pilot is p-median-us only regardless.
- **Focusable-marker keyboard navigation** (Tab to markers, Enter/Menu-key actions, keyboard move/copy) — the pilot ships keyboard-accessible dialogs/menus (D9); full marker keyboard-nav is deferred.
- **Base entity move/delete** (contradicts D1/DD-1) — not built; base "removal" is expressed as setting the entity Inactive via Edit.
- Touch gestures; marker clustering beyond nearest-hover.

## 11. Risks & mitigations

| Risk | Mitigation |
|------|-----------|
| Server-side normalization + augmented Save response desyncs the client | The Save reconciliation contract (§8): adopt the response into `localInputs`/`savedInputsRef`/cache; derive the estimate `N` by diffing returned `estimated` rows. Tested. |
| Auto-fill silently mutating user `inputs` feels surprising | The estimate toast + grid tint make every auto-filled row visible and labeled; idempotent; never overwrites a manual value. |
| Coincident/near added points produce a `0` distance that fails `positive()` | Clamp to `MIN_DISTANCE_MI = 0.1`; revalidate the normalized inputs before persistence; explicit zero/near-zero test. |
| Identity corruption on move (re-key touches the wrong override) | Stable `id` never changes (D7); move touches only `displayCode`/coords + the entity's own distance rows; override arrays are never re-keyed. Regression test: repairing an added/base displayCode collision leaves the base entity's override intact. |
| Cross-role id collision in the coord map | Separate role-scoped warehouse/customer coordinate maps; tested with a same-string cross-role id. |
| 200 draggable divIcon markers jank | Measured precedent (~130ms, D1.2). Only added markers are draggable. Revisit with virtualization only if measured jank. |
| Gazetteer coverage gaps | US Census Places filtered to ~1k cities is ample; the reverse-geocoded city/state is **editable** in every create/move dialog if the lookup is off. |

## 12. Design system

All new surfaces follow the **Industry** design system already applied to the Workspace as `.scn-theme` (Phase 3.1): steel-blue accent ramp, Barlow / Barlow Condensed, 0-radius blueprint frames, `+` registration corners on cards/dialogs, the single solid accent "Run Optimizer" button, 2px accent focus ring, Lucide icons. Map symbology draws only on the accent ramp (no second accent, no red — stale/destructive states use accent-800/900). New components (details card, action menus, dialogs, legend, toasts) reuse the system's card/dialog/table/button classes.
