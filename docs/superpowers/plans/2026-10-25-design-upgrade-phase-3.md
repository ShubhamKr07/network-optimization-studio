# Design Upgrade Phase 3 Implementation Plan (map interactions)

> **Execution:** agent-team dispatch per `AGENTS.md`, as in Phases 1–2.
>
> - **Worktrees:** the lead pre-creates one locked worktree per task (`git worktree add --lock /Users/shubhamkr/nos-du-3.N -b du-3.N-work <design-upgrade-p3 tip>`) and dispatches without `isolation`. The agent's first Bash command is `cd` plus a branch check.
> - **DU-3.1 to DU-3.4:** `frontend-engineer`. Each brief hands over that task's unit tests and e2e edits. The lead reviews on Opus with `ponytail-review`, then cherry-picks onto `design-upgrade-p3`.
> - **DU-3.5:** `qa-sdet`, reviewed by a separate `fable` reviewer agent.
> - Tasks run sequentially, and every task's commit is green on its own. Steps use checkbox (`- [ ]`) syntax.
>
> v2: Codex round-1 findings PR3-1..16 are folded into the task bodies (review log at the end).

**Goal:** implement spec §5.3 (`docs/superpowers/specs/2026-10-24-design-upgrade-design.md`), display and interaction only. That covers:
- touch/keyboard parity for map entity actions;
- truthful hints;
- Input Map selection;
- both-leg output filtering;
- a filter-aware narrative;
- popup/tooltip hygiene;
- per-product route popups;
- two items deferred from Phase 2: the legend overlapping tooltips, and the native-`title` "Unverified" tooltip.

**Architecture:**
- **New pure authorities:**
  - `entityActionsFor`, the one action list (master §A, exact one-argument form);
  - `actionsInContext`, which applies view rules on top of it;
  - `placeCard`, card placement that never covers the marker;
  - `warehouseFigures` and `servingWarehouseIds`, edge-derived focus and figures;
  - `productRoutesFor`, product → warehouse → feeding source;
  - `escapeHtml`, for the HTML popup.
- **Two small in-`MapContainer` bridges**, because the cards and the legend render outside `MapContainer` and have no Leaflet context:
  - `MapAnchorBridge` (marker → container point);
  - `MapOverlayEvents` (tooltip/popup open count).
- **Everything else** is wiring in the five Input Map arms, `NetworkMap`, `OutputMapTab`, `MapDetailsCard`, `CostSummaryTab` and `Landing`.
- **Unchanged:** API, schema, Zod, OpenAPI, codegen, manifests, solver, exports.

**Tech stack:** React 18, react-leaflet / Leaflet 1.9.4, Tailwind v4, vitest + RTL, Playwright.
- The Input Map tests use real react-leaflet markers.
- `NetworkMap.test.tsx` mocks `Tooltip`. It doesn't mock `Polyline` until DU-3.3 adds a probe.

## Global Constraints

The master plan's Global Constraints (`2026-10-24-design-upgrade.md:22-56`) bind every task. In addition:

**Interfaces**
- **Fixed interface (master §A, verbatim):** `entityActionsFor(entity: MapEntity): EntityAction[]` in `components/workspace/map/MapActionMenu.tsx`.
  - View rules (fixed geography, read-only) live in a separate exported `actionsInContext(entity, ctx)` built **on** `entityActionsFor`.
  - The menu, the card buttons and the hint all consume `actionsInContext`, so there is still exactly one list (PR3-1).

**Content rules**
- **Display and interaction only, with no invented figures.** No envelope has per-warehouse cost (grounding 2026-10-25), so the narrative never states one.
- **Reuse the Phase 2 authorities:** `formatDistanceDisplay`, `formatMoney`, `bandRangeLabel`, `EntityName` / `formatCityState`, `Chapter.demandUnit`. Role labels (mine / refinery / plant / warehouse) come from the existing map `EntityRoleConfig` roles (`components/workspace/map/types.ts:152-245`).
- **Phase 4 boundary:** popup inbound lanes use the current shared band lens (`labelBands`). `bandsForLeg` arrives in DU-4.1.

**Per-task obligations**
- **Sweep:** rg `artifacts/studio/src` **and** `artifacts/studio/e2e/` for every changed testid, string and prop, and fix all hits in the same commit. Each task lists its affected test files explicitly (PR3-15).
- **Changelog:** append `### DU-3.N — …` to `docs/CHANGELOG-implementation.md` in the same commit.
- **Gate:**
  - Per task: `pnpm run typecheck`, `pnpm --filter studio test` and `pnpm --filter studio run typecheck:e2e`, with zero concurrent vitest, one suite at a time, and never `pkill`.
  - At close-out: `pnpm gate` and `e2e:gate`.
  - Solver scripts are not required (master Q3).
- **Commit:**
  1. Guard the branch.
  2. Build a static `P`, then check `git diff --cached --name-only` equals P.
  3. Run `git commit --only ${=P} -m "[DU-3.N] …"`: no `--` before the paths, and on amend put `--no-edit` before the paths.

## Decisions (recommended defaults applied; to confirm before execution)

| ID | Default applied | Task |
|---|---|---|
| Q1 | `entityActionsFor(entity)` stays exactly as in master §A. `actionsInContext(entity, { fixedGeography?, readOnly? })` = `readOnly` → `[]`; `fixedGeography` → only `edit`; else `entityActionsFor(entity)`. | 3.1 |
| Q2 | The Super Input Map gains the details card on left-click, with the same buttons. Today left-click is a no-op (`SuperInputMap.tsx:105`). | 3.1, 3.2 |
| Q3 | Selecting a customer keeps bright its own lanes plus the inbound lanes into **every** warehouse that serves it (split sourcing included), and dims all others. | 3.3 |
| Q4 | The warehouse narrative states only derivable figures: customers served, demand served (outbound edge flow, in the chapter's `demandUnit`), average and farthest outbound distance, and the feeding sources named with the model's role label ("mine" on gold, "plant" on JADE and Super). It never states a per-warehouse cost. A warehouse with no outbound flow gets a short "serves no customers in this result" sentence. | 3.3 |
| Q5 | The Output Map legend fades to 15% opacity while any map tooltip or popup is open. The current layering explains the overlap (`.leaflet-container` is `z-0`, the legend is `z-10`). Fade is the chosen behaviour, verified in a real browser; no stacking redesign. | 3.4 |
| Q6 | "Unverified" gets a 24px ⓘ button (`aria-label="Why unverified?"`) that opens a shadcn `Popover` with `UNVERIFIED_TOOLTIP`. It works for tap, click, Enter/Space and Escape. The native `title` is removed. | 3.4 |
| Q7 | The gold fixed mine (`mine-marker-fixed`, a plain marker, `InputMapTab.tsx:1901-1915`) stays non-interactive. `bundle2-fastfollow.spec.ts:286-290` pins "no menu". | — |
| Q8 | The card anchors to the **marker's** container point, from `MapAnchorBridge`. It keeps a ≥ 24px gap from the selected marker's real icon envelope. Customers are demand-sized, up to about 38px, so the size is not a fixed 32 (PR3-5). It is positioned only once the container size is known. | 3.2 |
| Q9 | A split-sourced customer's route popup lists each of its products with its own warehouse. Its header warehouse line reads "Split across N warehouses". | 3.4 |

All paths below are relative to `artifacts/studio/src/` unless they start with `artifacts/`, `docs/` or `lib/`.

**Five Input Map arms (call-site matrix, PR3-15).** Every DU-3.1 / DU-3.2 change touches each arm's source and its test:

| Arm | Source (080fe5cd lines) | Unit tests |
|---|---|---|
| pmedian (+ delivery `fixedGeography`) | `InputMapTab.tsx:574-1012` (state :591-595, handlers :752-777, card :919-927, menu :938-969) | `InputMapTabV2.test.tsx`, `InputMapTab.deliveryFixedGeography.test.tsx`, `InputMapTab.maxCoverage.test.tsx`, `InputMapTabV2.customerStatus.test.tsx`, `InputMapV2.integration.test.tsx`, `Workspace.test.tsx:1330,3385`, `Workspace.Brazil.test.tsx:288` |
| transport | `InputMapTab.tsx:1130-1467` (handlers :1264-1285, card :1416-1423, menu :1424-1437) | `InputMapTabV2.transport.test.tsx` |
| twoEchelon (gold) | `InputMapTab.tsx:1618-1990` (handlers :1764-1785, card :1939-1946, menu :1947-1960) | `InputMapTabV2.twoEchelon.test.tsx`, `Workspace.TwoEchelon.test.tsx:355` |
| jade | `InputMapTab.tsx:2180-2561` (handlers :2336-2356, card :2493-2500, menu :2501-2514) | `InputMapTabV2.jade.test.tsx`, `Workspace.Jade.test.tsx:217` |
| super | `super/SuperInputMap.tsx:33-135` (menu :38, `startEdit` :74-81, left-click no-op :105, menu :110-116) | `SuperInputMap.test.tsx`, `Workspace.Super.test.tsx:163` |

The other `MapActionMenu` consumer is `mapDialogOptions.test.tsx:8-19`, which covers `confirmDelete={false}`.

---

### Task DU-3.1: One action list; card action buttons; truthful hint; Super card

**Files:**
- Modify:
  - `components/workspace/map/MapActionMenu.tsx`: export `EntityAction`, `entityActionsFor`, `actionsInContext`; the menu consumes `actionsInContext`; new optional `ctx` prop.
  - `components/workspace/map/MapDetailsCard.tsx`: action button row; hint derived from the actions; the `fixedGeography` prop is removed.
  - `components/workspace/tabs/InputMapTab.tsx`: delete `FixedGeographyActionMenu` (:372-431). In all four arms, refactor the menu handlers to take a `MapEntity` argument and share them between menu and card.
  - `components/workspace/super/SuperInputMap.tsx`:
    - new `selected` state;
    - left-click opens the card;
    - `startEdit` and the other handlers take a `MapEntity` instead of reading `menu` (PR3-4);
    - the existing move/zoom bridge at :102 also clears the selection.
- Test: every file in the arm matrix, plus `MapActionMenu.test.tsx`, `MapDetailsCard.test.tsx` and `mapDialogOptions.test.tsx`.
- e2e: rg `map-details-footer|Right-click for|map-action-`.

**Interfaces:**
```ts
// components/workspace/map/MapActionMenu.tsx
export type EntityActionKey = "edit" | "move" | "copy" | "delete";
export interface EntityAction { key: EntityActionKey; label: string; danger?: boolean }
/** Master §A — the ONE action list for an entity: added -> edit, move, copy, delete; base -> edit, copy. */
export function entityActionsFor(entity: MapEntity): EntityAction[];
/** View rules on top of entityActionsFor (PR3-1): readOnly -> []; fixedGeography -> [edit]; else entityActionsFor. */
export function actionsInContext(entity: MapEntity, ctx: { fixedGeography?: boolean; readOnly?: boolean }): EntityAction[];
```
- **Labels:** `"Edit…"`, `"Move"`, `"Copy"`, `"Delete"` (delete is `danger`). The menu keeps its local "Confirm delete?" step.
- **`MapDetailsCard`** gains three props:
  - `actions: EntityAction[]`;
  - `onAction(key: EntityActionKey): void`;
  - `confirmDelete?: boolean` (default true).

**Placement:** DU-3.1 uses the card's **existing** click-point positioning in every arm, Super included. DU-3.2 switches all five arms to `placeCard` together, so this commit doesn't depend on DU-3.2 (PR3-2).

- [ ] **Step 1: Write the failing unit tests**

`MapActionMenu.test.tsx` — `describe("entityActionsFor / actionsInContext")`:
```ts
const base = { kind: "wh", entity: { ...wh, isAdded: false } } as MapEntity;
const added = { kind: "cs", entity: { ...cs, isAdded: true } } as MapEntity;
it("base -> edit, copy", () => expect(entityActionsFor(base).map(a => a.key)).toEqual(["edit", "copy"]));
it("added -> all four; delete is danger", () => {
  const a = entityActionsFor(added);
  expect(a.map(x => x.key)).toEqual(["edit", "move", "copy", "delete"]);
  expect(a.find(x => x.key === "delete")!.danger).toBe(true);
});
it("fixed geography -> edit only, even for added", () =>
  expect(actionsInContext(added, { fixedGeography: true }).map(a => a.key)).toEqual(["edit"]));
it("read-only -> none", () => expect(actionsInContext(added, { readOnly: true })).toEqual([]));
it("no ctx flags -> identical to entityActionsFor", () => expect(actionsInContext(base, {})).toEqual(entityActionsFor(base)));
it("menu renders exactly actionsInContext keys, in order", () => { /* render for base, added, fixedGeography; compare map-action-* testids */ });
```

`MapDetailsCard.test.tsx`:
- **Buttons:** with `actions = entityActionsFor(base)`:
  - `map-details-action-edit` and `map-details-action-copy` are buttons with class `min-h-6`;
  - move and delete are absent.
- **Click:** edit calls `onAction("edit")`.
- **Delete:** with `confirmDelete`, the first click relabels to "Confirm delete?" and the second calls `onAction("delete")`. With `confirmDelete={false}` the first click calls it.
- **Footer:** reads `"Right-click for Edit · Copy"` for base and `"Right-click for Edit · Move · Copy · Delete"` for added; it's built from the labels with `…` stripped.
- **No actions:** `actions=[]` renders neither the footer nor the row.
- **Keyboard:** Tab from the root reaches the first button, and document Escape still calls `onClose`.

- [ ] **Step 2: Run them and confirm they fail.** `pnpm --filter studio test -- MapActionMenu MapDetailsCard`

- [ ] **Step 3: Implement.**
  - **Action functions.** `entityActionsFor` holds today's `MapActionMenu.tsx:59-81` logic, and `actionsInContext` wraps it. The menu builds its items from `actionsInContext(entity, ctx ?? {})`, mapping `run` to its existing callback props by key.
  - **Card.**
    - Add a row (`role="group" aria-label="Actions" data-testid="map-details-actions"`) with `data-testid={`map-details-action-${key}`}` buttons (`min-h-6 px-2 text-xs`, `text-danger` when danger).
    - Derive the hint from `actions`.
    - Handle the delete two-step locally.
  - **Four non-Super arms.**
    - Refactor `handleMenuEdit/Move/Copy/Delete` into `actOn(key, entity)`: same bodies, but taking the entity as a parameter instead of `actionMenu.entity`.
    - The menu calls `actOn(key, actionMenu.entity)`. The card calls `actOn(key, selected.entity)` and clears `selected` first.
    - The pmedian arm passes `ctx={{ fixedGeography }}` to the menu and `actions={actionsInContext(selected, { fixedGeography })}` to the card.
    - Delete `FixedGeographyActionMenu`. The plain menu now renders Edit-only with the same testids `map-action-menu` / `map-action-edit`.
  - **Super.**
    - Add `selected` state. `onLeftClick={(entity, e) => setSelected({ entity, containerPoint: e.containerPoint })}`.
    - Clear it on map click, right-click, move/zoom (extend the bridge at :102) and Escape.
    - Refactor `startEdit`, move-arm, copy and `onRequestDelete` to take the entity.
    - The card gets `actions={actionsInContext(entity, { readOnly })}` and `confirmDelete={false}` (D3: the cascade dialog confirms).

- [ ] **Step 4: Update the tests in the arm matrix, then run them.**
  - `MapDetailsCard.test.tsx:158,164`: derived footers.
  - `InputMapTab.deliveryFixedGeography.test.tsx:173-190`: Edit-only footer and menu, plus `map-details-action-edit` reaches the status edit.
  - `InputMapV2.integration.test.tsx`:
    - left-click then `map-details-action-move` arms the move;
    - the base card has no move or delete buttons.
  - `SuperInputMap.test.tsx`:
    - left-click opens `map-details-card`;
    - `map-details-action-delete` calls `onRequestDelete` on the first click;
    - in readOnly mode the card has no actions row;
    - edit opens `SuperEntityDialog` from the card.
  - **Arm tests:** add one card-button case per arm (transport, twoEchelon, jade): left-click a marker, click `map-details-action-edit`, and expect the arm's edit dialog.
  - `mapDialogOptions.test.tsx` is unchanged and must stay green.
  - Run typecheck, studio test and typecheck:e2e.

- [ ] **Step 5: Review and commit.**
  - Run `ponytail-review`.
  - Commit `[DU-3.1] one entity action list feeds menu, card buttons and hint; Super gets the details card`.
  - The changelog records Q1, Q2 and Q7.

---

### Task DU-3.2: Input Map selection ring; card close button; marker-anchored placement

**Files:**
- Create:
  - `components/workspace/map/placeCard.ts` and `__tests__/placeCard.test.ts`;
  - `components/workspace/map/MapAnchorBridge.tsx`.
- Modify:
  - `components/workspace/map/EntityMarkers.tsx`: `selectedKey?: string` and a ring in the icon builders. Export `markerEnvelope(kind, entity, opts)`, which returns the rendered icon size: warehouse 22 (32 when selected), plant 20 (32 when selected), customer `ceil(r*2)+4` (+6 when selected).
  - `components/workspace/map/MapDetailsCard.tsx`:
    - close button;
    - positions via `placeCard`, with the new props `anchor: Point` and `markerSize: number` replacing `containerPoint`;
    - measures its own height after mount.
  - All five arms: render `<MapAnchorBridge>` inside `MapContainer`, pass `selectedKey`, `anchor` and `markerSize`, and don't render the card until `containerSize` is known.
- Test: `placeCard.test.ts`, `EntityMarkers.test.tsx`, `MapDetailsCard.test.tsx` (flip tests at :134,169), `InputMapV2.integration.test.tsx`, `SuperInputMap.test.tsx`.

**Interfaces:**
```ts
// components/workspace/map/placeCard.ts
export interface Point { x: number; y: number }
export interface Size { width: number; height: number }
/** DU-3.2 — card top-left near `anchor` (the MARKER's container point) inside `container`, never intersecting the
 *  marker's `markerSize` px square (centred on anchor) grown by `gap`. Preference: right-below, left-below,
 *  right-above, left-above; if none fits, the candidate with the least overlap, clamped to 4px. */
export function placeCard(anchor: Point, card: Size, container: Size, markerSize: number, gap = 24):
  { left: number; top: number; flippedX: boolean; flippedY: boolean };

// components/workspace/map/MapAnchorBridge.tsx — rendered INSIDE <MapContainer> (PR3-3)
/** Reports the selected entity's marker position in the map container's pixel space (useMap().latLngToContainerPoint),
 *  re-reporting on the map's `move`/`zoom`/`resize` while a selection exists. */
export function MapAnchorBridge(props: { latLng: [number, number] | null; onAnchor(p: Point | null): void }): null;
```
- **Selected key format:** `` `${kind}:${id}` ``.
- **Ring:** the Output Map pattern, `<circle fill="none" stroke="var(--map-ring-select)" stroke-width="2">` (`NetworkMap.tsx:75-89`).
- **Coordinate space:** the card and `MapContainer` share the same `relative` wrapper, at origin (0,0). So the container point is also the card's coordinate space. Assert this in a test.

- [ ] **Step 1: Write the failing tests**

`placeCard.test.ts`:
```ts
const card = { width: 224, height: 230 }, C = { width: 800, height: 600 }, gap = 24;
const rect = (p: { left: number; top: number }) => ({ l: p.left, t: p.top, r: p.left + card.width, b: p.top + card.height });
const keepOut = (a: { x: number; y: number }, m: number) => ({ l: a.x - m / 2 - gap, t: a.y - m / 2 - gap, r: a.x + m / 2 + gap, b: a.y + m / 2 + gap });
const overlaps = (a: any, b: any) => a.l < b.r && a.r > b.l && a.t < b.b && a.b > b.t;
it.each([[100, 100], [790, 100], [100, 590], [790, 590], [400, 300]])("never covers a 32px marker at (%i,%i)", (x, y) =>
  expect(overlaps(rect(placeCard({ x, y }, card, C, 32, gap)), keepOut({ x, y }, 32))).toBe(false));
it("never covers the largest demand bubble (44px incl. ring) near the bottom-right", () =>
  expect(overlaps(rect(placeCard({ x: 780, y: 580 }, card, C, 44, gap)), keepOut({ x: 780, y: 580 }, 44))).toBe(false));
it("prefers right-below when it fits", () => {
  const p = placeCard({ x: 100, y: 100 }, card, C, 32);
  expect(p.flippedX || p.flippedY).toBe(false);
});
it("flips left near the right edge", () => expect(placeCard({ x: 790, y: 100 }, card, C, 32).flippedX).toBe(true));
```
- **`EntityMarkers.test.tsx`:**
  - with `selectedKey="wh:W1"`, W1's icon HTML contains `var(--map-ring-select)` and has size 32, while W2 has neither;
  - `cs:`/`pl:` keys behave the same way;
  - a customer whose id is `W1` is not ringed;
  - `markerEnvelope` matches each icon's rendered size.
- **`MapDetailsCard.test.tsx`:**
  - `map-details-close` (`aria-label="Close"`, `min-h-6 min-w-6`) calls `onClose`;
  - the position equals `placeCard(anchor, …)` and not the click point.
- **Integration (pmedian and Super):** after left-click, the card's `style.left/top` equals `placeCard` computed from the marker's `latLngToContainerPoint`, read from a real Leaflet map in jsdom, not from `e.containerPoint`.

- [ ] **Step 2: Run them and confirm they fail.**

- [ ] **Step 3: Implement.**
  - Write `placeCard` and `MapAnchorBridge`.
  - In each arm:
    - store the selected entity, not the click point;
    - render `<MapAnchorBridge latLng={selected ? [lat, lng] : null} onAnchor={setAnchor} />` inside `MapContainer`;
    - pass `anchor`, `markerSize={markerEnvelope(...)}` and `containerSize` to the card;
    - render the card only when `anchor` and `containerSize` are both non-null. Super gets a wrapper ref so it can read `containerSize`.
  - The card measures `ref.offsetHeight` after mount, falling back to a `CARD_HEIGHT` of 230 that includes the action row, then re-places itself.
  - Thread `selectedKey` into `warehouseIcon`, `plantIcon` and `customerIcon`.

- [ ] **Step 4: Update the tests and sweep.**
  - Update the flip tests to use anchors.
  - Check the `e2e/` specs for the card. `input-map-v2.spec.ts:383-388` only checks visibility and that a pan hides the card. Pan now re-anchors via the bridge, so update that spec to: pan keeps the card attached to the marker, and a map-background click hides it.
  - Run typecheck, studio test and typecheck:e2e.

- [ ] **Step 5: Review and commit.** Commit `[DU-3.2] Input Map selection ring; card close button; card anchored to and placed off the selected marker`.

---

### Task DU-3.3: Output filter dims both legs; filter-aware narrative

**Files:**
- Create: `lib/warehouseFigures.ts` (exports `warehouseFigures`, `servingWarehouseIds`) and `__tests__/warehouseFigures.test.ts`.
- Modify:
  - `components/NetworkMap.tsx`:
    - focus sets at :552-559 and :610-640;
    - lane dim at :709-750, which removes the inbound exemption;
    - plant icon dim at :169-181 and :884-895;
    - mine/refinery dim at :842-850;
    - new `onWarehouseSelectionChange?` prop.
  - `components/workspace/tabs/OutputMapTab.tsx:232-242,496-519`.
  - `lib/resultNarrative.ts` (selected branch placed **before** the Super branch at :106-115; PR3-8).
- Test:
  - `warehouseFigures.test.ts`;
  - `NetworkMap.test.tsx`, which adds a `Polyline` mock probe (PR3-14);
  - `resultNarrative.test.ts`;
  - `OutputMapTab.test.tsx`.

**Interfaces:**
```ts
// lib/warehouseFigures.ts
export interface WarehouseFigures {
  customers: number;            // distinct outbound toIds from this warehouse
  demandServed: number;         // Σ outbound edge flow (edges are product-aggregated on JADE/Super: solve.py:1336-1340)
  avgDistance: number | null;   // flow-weighted mean outbound distance (canonical); null when no outbound flow
  farthest: { customerId: string; distance: number } | null;
  feedingIds: string[];         // distinct fromIds of inbound-leg edges into this warehouse, sorted
}
export function warehouseFigures(result: SolveResult, warehouseId: string): WarehouseFigures;
/** Every warehouse with a non-inbound edge to this customer (split sourcing → several). */
export function servingWarehouseIds(result: SolveResult, customerId: string): string[];
```
Legs come from `isInboundLeg` in `lib/legPalette.ts`. Figures use **edges only**, never `details.assignments`.

- [ ] **Step 1: Write the failing tests**

**`warehouseFigures.test.ts`.** Fixtures: `__tests__/fixtures/narrative/*.json` and `fixtures/superResult.json`.
- **p-median-us:** customers and demand equal an inline filter/reduce over that warehouse's outbound edges, and `avg = Σ(flow·d)/Σflow`.
- **Gold:** `feedingIds` are the `mine_to_refinery` fromIds into it.
- **JADE and Super:** `feedingIds` are the `plant_to_warehouse` fromIds into it, and `demandServed` equals the outbound edge sum. A guard asserts it is NOT the `details.assignments` per-product sum when those differ.
- **No outbound flow:** an open warehouse gives `customers 0`, `avgDistance null`, `farthest null`.
- **Unknown id:** gives all zeros and nulls.
- **`servingWarehouseIds`:** a synthetic result whose customer has edges from two warehouses returns both.

**`NetworkMap.test.tsx`.** Mock `Polyline` to record `pathOptions` keyed by `fromId|toId`; keep the real map for markers.
- **Warehouse filter:** after clicking warehouse A on a gold fixture (`mine_to_refinery` + `refinery_to_customer`), opacity is:
  - 0.75 on A's outbound edges and on the inbound edges into A;
  - **0.1 on every other edge, including inbound edges into other refineries.**
  - Repeat on JADE and Super fixtures.
- **Customer select (Q3):** the lanes of the selected customer and the inbound lanes into every serving warehouse stay bright, and everything else dims. Test both single-sourced and split-sourced customers.
- **Non-vacuity:** without any selection, no edge has opacity 0.1.
- **Plant / source icon dim:** a plant or source not connected to the focus renders the dimmed icon (opacity 0.25 in the icon HTML).
- **Callback:** `onWarehouseSelectionChange` fires with A, then with null on re-click.

**`resultNarrative.test.ts`:**
- With `selectedWarehouseId`, the text follows this template (placeholders, not real figures):

  `"{Warehouse City, ST} serves {customers} customers — {demandServed} {demandUnit} of demand, about {avgDistance} {unit} on average; the farthest is {Customer City, ST} at {farthest} {unit}."`

  Multi-echelon models append `" It is fed from {role}s {A}, {B}."`, where role is "mine" on gold and "plant" on JADE and Super. The expected string is computed from the fixture via `warehouseFigures`.
- **Super:** the selected branch must win over the Super branch.
- **No outbound flow:** gives `"{Warehouse City, ST} serves no customers in this result."`
- **No cost:** the text has no `$` token.
- **No selection:** byte-identical to today, for every model.

- [ ] **Step 2: Run them and confirm they fail.**

- [ ] **Step 3: Implement.**
  - **Focus sets in `NetworkMap`.**
    - `focusEdgeKeys` is a `Set` of `fromId|toId` keys.
    - Warehouse filter `A`: outbound edges with `fromId === A`, plus inbound edges with `toId === A`.
    - Customer `C`: `S = servingWarehouseIds(result, C)`; outbound edges with `toId === C`, plus inbound edges with `toId ∈ S`.
    - `dimmed = anySelection && !focusEdgeKeys.has(key)`, applied to **every** leg. This removes `!isInboundEdge` at :712-713.
    - Plants/sources and mine/refinery icons dim when no focus edge touches them. Pass a `dimmed` argument to the plant icon builder; the mine dimming drops its `isOpen` gate.
    - Call `onWarehouseSelectionChange` from an effect on `selectedWarehouseId`.
  - **`OutputMapTab`** holds the id and passes it into the narrative ctx. It also passes `demandUnit` (`chapterForModelId(modelId)?.demandUnit`) and the role label, and keeps `nameById`.
  - **`resultNarrative`.** `NarrativeContext` gains `selectedWarehouseId?`, `demandUnit?` and `sourceRole?`. The selected branch runs first, and everything else is unchanged.

- [ ] **Step 4: Sweep.**
  - rg `src` and `e2e` for `output-map-narrative` and the dimming expectations. `design-upgrade-p2.spec.ts:767-781` (narrative with no selection) must hold.
  - Run typecheck, studio test and typecheck:e2e.

- [ ] **Step 5: Review and commit.** Commit `[DU-3.3] output selection dims both legs and unconnected sources; narrative follows the selected warehouse`.

---

### Task DU-3.4: Popup hygiene, per-product routes, legend yields, reachable "Unverified"

**Files:**
- Create:
  - `lib/productRoutes.ts`;
  - `lib/escapeHtml.ts`;
  - `components/workspace/map/MapOverlayEvents.tsx`;
  - `components/UnverifiedInfo.tsx`;
  - `__tests__/productRoutes.test.ts`;
  - `__tests__/escapeHtml.test.ts`;
  - `__tests__/fixtures/jadeRouteFixture.ts`: a typed JADE result **with** `details.assignments`, its companion dataset (products, plants, warehouses, customers) and one split-sourced customer (PR3-9).
- Modify:
  - `components/NetworkMap.tsx:241-326,545-608,821-834,897-912`:
    - popup state carries every serving warehouse (PR3-10);
    - `escapeHtml` on **every** interpolation in `buildCustomerPopupHtml` (PR3-11);
    - customer tooltip suppression;
    - legend `dimmed`.
  - `components/workspace/map/MapLegend.tsx`: `dimmed?: boolean`.
  - `components/workspace/tabs/CostSummaryTab.tsx:210,625,859-862` and `pages/Landing.tsx:216-224`: remove the `title`s.
- Test:
  - `productRoutes.test.ts`, `escapeHtml.test.ts`;
  - `NetworkMap.test.tsx` (the popup-HTML tests at :1272-1290 and :1600-1683);
  - `MapLegend.test.tsx`;
  - `CostSummaryTab.test.tsx:459-504`, `Landing.test.tsx:225-243`.

**Interfaces:**
```ts
// lib/productRoutes.ts
export interface ProductRoute {
  productId: string; productName: string;
  warehouseId: string; outboundDistance: number;                      // canonical, from the assignment
  sources: { sourceId: string; flow: number; distance: number }[];    // inbound edges with this productId into warehouseId, flow desc
}
/** Per-product routes for one customer from details.assignments (guarded: rows must have customerId, warehouseId,
 *  productId, distanceMi). [] when the result has no product-level assignments (single-product models). */
export function productRoutesFor(result: SolveResult, dataset: Dataset, customerId: string): ProductRoute[];

// lib/escapeHtml.ts
export function escapeHtml(s: string): string; // & < > " '

// components/workspace/map/MapOverlayEvents.tsx — rendered INSIDE <MapContainer> (PR3-12)
/** Counts open overlays via map tooltipopen/tooltipclose/popupopen/popupclose (a counter, floored at 0 —
 *  closing one overlay never un-fades while another is open) and reports `count > 0`. */
export function MapOverlayEvents(props: { onChange(open: boolean): void }): null;
```
- `PopupInfo` gains `warehouses: string[]`, the serving warehouse names; the header shows one name, or "Split across N warehouses" (Q9).
- It also gains `products?: { name; warehouse; sources; outbound; inbound }[]`. All fields are pre-formatted, and all are escaped at render.

- [ ] **Step 1: Write the failing tests**
  - **`productRoutes.test.ts`** (on `jadeRouteFixture`):
    - a 2-product customer gives 2 routes with the assignment's warehouse and distance;
    - `sources` are inbound edges with the same productId into that warehouse, flow descending;
    - the split customer's two products carry **different** warehouses;
    - a p-median result gives `[]`;
    - malformed assignment rows are skipped and don't throw.
  - **`escapeHtml.test.ts`:** `<img onerror=x>` and `"&'` get escaped.
  - **`NetworkMap.test.tsx`:**
    - **Injection:** a customer city, warehouse name, product name and plant name containing `<script>` render escaped in `buildCustomerPopupHtml`. Assert `container.querySelector("script") === null` after setting the HTML.
    - **Split:** the split customer's popup header reads "Split across 2 warehouses", and it has one product row per product.
    - **Tooltip suppression:** after clicking customer C, the mocked Tooltip is not called for C but still is for other customers.
    - **Legend:** with `MapOverlayEvents` mounted in a real `MapContainer`:
      - `map.fire("tooltipopen")` makes the legend `opacity-15`;
      - a second open, then one close, keeps it faded;
      - the second close restores it.
  - **`CostSummaryTab` / `Landing`:**
    - "Unverified" has no `title`;
    - `button-unverified-info` exists, with an `aria-label` and `min-h-6 min-w-6`;
    - click → `popover-unverified` shows `UNVERIFIED_TOOLTIP`;
    - focus + Enter opens it, and Escape closes it.

- [ ] **Step 2: Run them and confirm they fail.**

- [ ] **Step 3: Implement.**
  - **Popup memo:** replace the single-edge `assignmentMap` (:545-549) with `servingWarehouseIds` plus `productRoutesFor`.
  - **`buildCustomerPopupHtml`:** escape every dynamic string through `escapeHtml`, including numbers converted to strings and the band label, and render the product rows block.
  - **Customer `<Tooltip>`:** skip it when `selectedCustomerId === c.id`.
  - **Legend fade:** mount `<MapOverlayEvents onChange={setOverlayOpen} />` inside `MapContainer`, and pass `dimmed={overlayOpen}` to the output legend.
  - **`UnverifiedInfo`:** an ⓘ button plus `Popover` from `components/ui/popover.tsx`, with testids `button-unverified-info` and `popover-unverified`. It replaces all three `title` sites. Remove the `r.title` plumbing at `CostSummaryTab.tsx:210` and `resultQualityTitle` if they become unused (rg).

- [ ] **Step 4: Sweep.**
  - rg `src` and `e2e` for `.leaflet-popup-content`, `badge-legacy-unverified`, `title=` (quality), `resultQualityTitle`, `bandLabelText` and `warehouseCity`. `jade-ch9-workspace-bundle.spec.ts:373-390` (popup range text) must hold.
  - Run typecheck, studio test and typecheck:e2e.

- [ ] **Step 5: Review and commit.** Commit `[DU-3.4] popup hides its own tooltip, lists per-product routes incl. split sourcing (escaped); legend yields to overlays; Unverified reachable by tap and keyboard`.

---

### Task DU-3.5: Phase 3 real-browser QA, including touch (qa-sdet)

**Files:**
- Create: `artifacts/studio/e2e/design-upgrade-p3.spec.ts` and `artifacts/studio/e2e/helpers/topmostMarker.ts`. The latter generalises the topmost-marker helper at `super-model.spec.ts:99-120` for tap and click: it isolates by zooming when markers overlap, and uses `elementFromPoint` only for hit-testing (`e2e/CLAUDE.md:6`).
- Reuse: `seedSolvedResult`, `solvedModelInputs`, `fixtures/solved/*.json`.
- Modify: sibling specs that Phase 3 broke; the changelog; the flake registry.

- [ ] **Step 1: Bring up the local servers** on free ports, per `artifacts/studio/e2e/CLAUDE.md`.

- [ ] **Step 2: Write the spec.** Every check must be able to fail: assert the locator count is > 0 before each loop, and give each detector an injected probe.
  - **Touch parity.** Use `test.use({ hasTouch: true, isMobile: true, viewport: { width: 820, height: 1180 } })`, with no right-click anywhere in this block. Select markers via `topmostMarker` + `tap()`.
    - A base warehouse shows only Edit and Copy.
    - An added entity shows all four actions.
    - `map-details-action-move` arms the move (`armed-status-bar`).
    - Delivery shows Edit only.
    - On Super, a tap opens the card.
  - **Keyboard.**
    - Tab reaches `map-details-action-edit`, and Enter opens the edit dialog.
    - Escape closes the card and returns focus.
  - **Hint truth.** For base, added and fixed-geography entities, the footer equals `"Right-click for " +` the visible action labels.
  - **Ring.** Only the selected marker's icon has a `--map-ring-select` stroke.
  - **Placement.** Near each edge, the card box doesn't intersect the selected marker's bounding box padded by 24px. Include the largest demand bubble.
  - **Pan.** The card stays attached to the marker.
  - **Close.** `map-details-close` hides the card.
  - **Output filter** (gold, JADE, Super). Clicking an open warehouse:
    - sets computed `stroke-opacity` to 0.1 on every unconnected `.leaflet-route-pane` path, on both legs, and keeps connected paths at 0.75;
    - dims unconnected source icons;
    - makes the narrative contain the warehouse name and no `$`.

    Re-clicking restores everything.
  - **Popup.**
    - While `.leaflet-popup` is open, no `.leaflet-tooltip` is visible for that customer.
    - A JADE popup lists products with warehouse and source.
    - The legend's opacity is ≤ 0.2 while a tooltip shows, and 1 afterwards.
  - **Unverified.** With a seeded legacy-unverified result:
    - tap shows `popover-unverified`, and so do Tab + Enter;
    - the word has no `title`.

- [ ] **Step 3: Sweep and gate.**
  - Grep `e2e/` for: `map-details-footer`, `Right-click for`, `map-action-`, `map-details-close`, `output-map-narrative`, `.leaflet-popup-content`, `badge-legacy-unverified`, `rightClickPin`.
  - Run `E2E_BASE_URL=… pnpm e2e:gate` with the new spec. If a product bug shows up, STOP and report it.

- [ ] **Step 4: Screenshots** into the scratchpad, reviewed:
  - the tablet card with actions;
  - the selection ring;
  - the JADE filter dimmed on both legs;
  - a split-sourced popup;
  - the faded legend;
  - the Unverified popover.

- [ ] **Step 5: Commit** `[DU-3.5] Phase 3 real-browser QA incl. touch viewport + sibling sweep`. Stop the servers by PID. The lead then dispatches the fable reviewer.

---

## Phase 3 close-out

1. Message Super Model.
2. Run `pnpm gate` serially, then `E2E_BASE_URL=… pnpm e2e:gate`.
3. Run `/harness-retro DU-3`. It also fills the DU-2 `merged_sha` = DU-2.R1 on main (`35de1e93`).
4. Run `superpowers:finishing-a-development-branch`.
5. STOP and ask for merge approval. Push and deploy are separate approvals.

## Self-review

| Spec / scope item | Task |
|---|---|
| §5.3.1 touch + keyboard parity | DU-3.1 (buttons, keyboard), DU-3.5 (touch viewport) |
| §5.3.2 truthful hint | DU-3.1, derived from `actionsInContext` |
| §5.3.3 selection ring, close button, placement | DU-3.2 |
| §5.3.4 filter on both legs, narrative | DU-3.3 |
| §5.3.4 tooltip suppression, product popup, shared-lens inbound band | DU-3.4 |
| Phase 2 deferrals | DU-3.4 (Q5, Q6) |

- **Fixed interface:** `entityActionsFor(entity: MapEntity): EntityAction[]` is verbatim (master §A:108).
- **No invented figures:** narrative figures come from edges only.
- **Sequencing:** each commit is green alone. DU-3.1 keeps the existing card placement; DU-3.2 switches all arms together.

## Review log — Codex round 1 (high effort, 2026-10-25)

Verdict on v1: NOT READY. All 16 findings were folded:

| ID | Sev | Finding | Resolution |
|---|---|---|---|
| PR3-1 | blocker | Q1 changed the fixed interface | `entityActionsFor` kept verbatim; `actionsInContext` wraps it |
| PR3-2 | major | DU-3.1 depended on DU-3.2's `placeCard` | DU-3.1 keeps the existing placement; DU-3.2 switches all arms |
| PR3-3 | blocker | No Leaflet context where the card renders | `MapAnchorBridge` inside `MapContainer`; same-wrapper origin asserted |
| PR3-4 | major | Super handlers read `menu`; left-click is a no-op | Handlers take the entity; selection state + clearing added |
| PR3-5 | major | Fixed 32px box wrong for demand bubbles; optional container | `markerEnvelope` real size; container required; largest-bubble test |
| PR3-6 | major | Inbound exemption; sources never dim | Focus edge sets per selection on all legs; plant/mine dim |
| PR3-7 | major | Null `farthest` vs template; JADE edges are product-aggregate | No-service sentence; edges-only, with a guard test |
| PR3-8 | major | Super narrative branch returns first | Selected branch first; Super test |
| PR3-9 | major | Fixture lacks assignments/dataset; no split test | `jadeRouteFixture` with dataset + split customer |
| PR3-10 | major | Popup picks one edge per customer | Serving warehouses list; "Split across N" (Q9) |
| PR3-11 | major | Escaping only names | `escapeHtml` on every interpolation + injection test |
| PR3-12 | blocker | Legend events lack map context; boolean | `MapOverlayEvents` inside `MapContainer`; floored counter |
| PR3-13 | minor | "z-index fix impossible" overstated | Reworded; fade is the chosen behaviour, browser-verified |
| PR3-14 | major | Polyline opacity unobservable in the test | `Polyline` mock probe + non-vacuity case |
| PR3-15 | major | Arm/test inventory incomplete | Five-arm source/test matrix; src + e2e sweep |
| PR3-16 | major | Bare tap may hit overlapping markers | `topmostMarker` helper (tap/click), zoom isolation |
