# Design Upgrade Phase 3 Implementation Plan (map interactions)

> **Execution:** agent-team dispatch per `AGENTS.md`, the same as Phases 1–2.
> - The lead pre-creates one locked worktree per task (`git worktree add --lock /Users/shubhamkr/nos-du-3.N -b du-3.N-work <design-upgrade-p3 tip>`) and dispatches without `isolation`. The agent's first Bash command is `cd` plus a branch check.
> - DU-3.1 to DU-3.4 are `frontend-engineer` tasks. Each brief hands over the task's unit tests and e2e edits. The lead reviews each one on Opus with `ponytail-review`, then cherry-picks it onto `design-upgrade-p3`.
> - DU-3.5 is a `qa-sdet` task, reviewed by a separate `fable` reviewer agent.
> - Tasks run sequentially. Steps use checkbox (`- [ ]`) syntax.

**Goal:** implement spec §5.3 (`docs/superpowers/specs/2026-10-24-design-upgrade-design.md`), display and interaction only. It covers touch/keyboard parity for map entity actions, truthful hints, Input Map selection, both-leg output filtering, a filter-aware narrative, popup/tooltip hygiene, and per-product route popups. It also covers the two items deferred from Phase 2: the legend overlapping tooltips, and the native-`title` "Unverified" tooltip.

**Architecture:**
- **New pure authorities:**
  - `entityActionsFor` (the one action list, master §A);
  - `placeCard` (card placement that never covers the anchor marker);
  - `warehouseFigures` (per-warehouse figures derived from result edges);
  - `productRoutesFor` (product → warehouse → feeding plant).
- **Everything else** is component wiring in the five Input Map arms, `NetworkMap`, `OutputMapTab`, `MapDetailsCard`, `CostSummaryTab` and `Landing`.
- **No change to** the API, schema, Zod, OpenAPI, codegen, manifests, the solver or exports.

**Tech stack:** React 18, react-leaflet / Leaflet 1.9.4, Tailwind v4, vitest + RTL (react-leaflet is not mocked for the Input Map tests), Playwright.

## Global Constraints

The master plan's Global Constraints (`2026-10-24-design-upgrade.md:22-56`) bind every task. On top of those:

**Interfaces and scope**
- **Fixed interface (master §A):** `entityActionsFor(entity: MapEntity): EntityAction[]` in `components/workspace/map/MapActionMenu.tsx`. It is the single list consumed by the menu, the card buttons and the hint. Q1 adds one *optional* second parameter. Every existing one-argument call stays valid.
- **Display and interaction only.** Result envelopes stay untouched, and no figure is invented. Per-warehouse cost doesn't exist in any envelope (grounding 2026-10-25), so the narrative never states one.
- **Phase 2 authorities are reused, never re-rolled:**
  - distances use `formatDistanceDisplay`;
  - money uses `formatMoney`;
  - band text uses `bandRangeLabel`;
  - names use `EntityName` / `formatCityState`.
- **Phase 4 boundary:** popup inbound lanes use the current shared band lens (`labelBands`). `bandsForLeg` arrives in DU-4.1.

**Per-task process**
- **Sibling e2e sweep:** rg `artifacts/studio/e2e/` for every testid and string the task changes, and rewrite those specs in the same commit.
- **Changelog:** each task appends `### DU-3.N — …` to `docs/CHANGELOG-implementation.md` in the same commit.
- **Gate:** `pnpm run typecheck`, `pnpm --filter studio test` and `pnpm --filter studio run typecheck:e2e`, with zero concurrent vitest. Run one suite at a time and never `pkill`. `pnpm gate` plus `e2e:gate` run at close-out. Solver scripts are not required (master Q3).
- **Commit:** guard the branch, use a static `P` list, check `git diff --cached --name-only` equals P, then `git commit --only ${=P} -m "[DU-3.N] …"`. No `--` before the paths, and `--no-edit` before the paths on an amend.

## Decisions to confirm (recommended defaults applied; via Lavish before execution)

| ID | Default applied | Task |
|---|---|---|
| Q1 | `entityActionsFor(entity, ctx?: { fixedGeography?: boolean; readOnly?: boolean })`. The second parameter is optional and additive, so the master name and one-argument form still hold. Without it, delivery's Edit-only menu and Super's read-only history couldn't come from the one list. | 3.1 |
| Q2 | Super Input Map gains the details card (left-click), with the same action buttons. Today left-click is a no-op, so touch users have no path to Super actions at all. | 3.1 |
| Q3 | Selecting a **customer** also keeps the inbound lanes of its serving warehouse bright, and dims all others. This mirrors the warehouse rule. | 3.3 |
| Q4 | The warehouse-scoped narrative states only derivable figures: customers served, demand served (in the chapter's `demandUnit`), average and farthest outbound distance, and, on multi-echelon models, the feeding plants. It gives no per-warehouse cost. | 3.3 |
| Q5 | Legend/tooltip overlap: the Output Map legend **fades to 15% opacity while any map tooltip or popup is open**, using Leaflet `tooltipopen`/`tooltipclose`/`popupopen`/`popupclose`. A z-index fix is impossible: `.leaflet-container` is a `z-0` stacking context beneath the `z-10` legend. | 3.4 |
| Q6 | "Unverified" gets a 24px info button (ⓘ, `aria-label="Why unverified?"`) that opens a shadcn `Popover` with `UNVERIFIED_TOOLTIP`. That works for tap, click and keyboard (Enter/Space, Escape). The native `title` goes. | 3.4 |
| Q7 | The gold model's fixed mine (`mine-marker-fixed`, a plain marker) stays non-interactive. It has no actions to offer, and `bundle2-fastfollow.spec.ts:286-290` pins "no menu". | 3.1 |
| Q8 | The card anchors to the **marker's** container point (`map.latLngToContainerPoint(entity latlng)`), not the click point, with a ≥ 24px gap from the marker's 32px box in every flip. | 3.2 |

All paths below are relative to `artifacts/studio/src/` unless they start with `artifacts/`, `docs/` or `lib/`.

---

### Task DU-3.1: One action list; card action buttons; truthful hint; Super card

**Files:**
- Modify:
  - `components/workspace/map/MapActionMenu.tsx`: add and export `EntityAction`, `entityActionsFor`; the menu consumes them.
  - `components/workspace/map/MapDetailsCard.tsx`: action buttons, derived hint.
  - `components/workspace/tabs/InputMapTab.tsx`: delete `FixedGeographyActionMenu` (:372-431); each arm passes its handlers to the card.
  - `components/workspace/super/SuperInputMap.tsx`: left-click opens the card; card and menu share the handlers.
- Test: `__tests__/MapActionMenu.test.tsx`, `__tests__/MapDetailsCard.test.tsx`, `__tests__/InputMapTab.deliveryFixedGeography.test.tsx`, `__tests__/InputMapV2.integration.test.tsx`, `__tests__/SuperInputMap.test.tsx`, plus the arm tests listed under Step 4.
- e2e: rg `map-details-footer`, `Right-click for`, `map-action-`.

**Interfaces:**
```ts
// components/workspace/map/MapActionMenu.tsx
export type EntityActionKey = "edit" | "move" | "copy" | "delete";
export interface EntityAction { key: EntityActionKey; label: string; danger?: boolean }
/** DU-3.1 — the ONE action list (menu, card buttons, hint). */
export function entityActionsFor(
  entity: MapEntity,
  ctx?: { fixedGeography?: boolean; readOnly?: boolean },
): EntityAction[];
```
The rules preserve today's behaviour:
- `readOnly` → `[]`
- `fixedGeography` → `[edit]`
- `entity.entity.isAdded` → `[edit, move, copy, delete]`
- base → `[edit, copy]`

The labels are `"Edit…"`, `"Move"`, `"Copy"` and `"Delete"` (delete is `danger: true`). The menu keeps its two-step "Confirm delete?" relabel locally.

`MapDetailsCard` gains these props: `actions: EntityAction[]`, `onAction(key: EntityActionKey): void`, `confirmDelete?: boolean` (default true).

- [ ] **Step 1: Write the failing unit tests**

`__tests__/MapActionMenu.test.tsx`, new `describe("entityActionsFor")`:
```ts
const base = { kind: "wh", entity: { ...wh, isAdded: false } } as MapEntity;
const added = { kind: "cs", entity: { ...cs, isAdded: true } } as MapEntity;
it("base -> edit, copy", () => expect(entityActionsFor(base).map(a => a.key)).toEqual(["edit", "copy"]));
it("added -> all four, delete is danger", () => {
  const a = entityActionsFor(added);
  expect(a.map(x => x.key)).toEqual(["edit", "move", "copy", "delete"]);
  expect(a.find(x => x.key === "delete")!.danger).toBe(true);
});
it("fixed geography -> edit only, even for added", () =>
  expect(entityActionsFor(added, { fixedGeography: true }).map(a => a.key)).toEqual(["edit"]));
it("read-only -> none", () => expect(entityActionsFor(added, { readOnly: true })).toEqual([]));
it("the menu renders exactly entityActionsFor's keys, in order", () => { /* render MapActionMenu for base and added; compare map-action-* testids */ });
```

`__tests__/MapDetailsCard.test.tsx`:
- Render with `actions = entityActionsFor(base)`. Expect buttons `map-details-action-edit` and `map-details-action-copy`; move and delete are absent. Each button is a `BUTTON` with class `min-h-6`.
- Clicking edit calls `onAction("edit")`.
- Delete is two-step when `confirmDelete`: the first click relabels it "Confirm delete?", and the second calls `onAction("delete")`.
- The footer text equals `"Right-click for " + labels.join(" · ")` with `…` stripped, i.e. `"Right-click for Edit · Copy"` for base. With `actions=[]` there's no footer and no button row.
- Keyboard: Tab from the card root reaches the first action button, and Escape still calls `onClose`.

- [ ] **Step 2: Run them and confirm they fail.** `pnpm --filter studio test -- MapActionMenu MapDetailsCard`.

- [ ] **Step 3: Implement.**
  - Move today's action-list logic (`MapActionMenu.tsx:59-81`) into `entityActionsFor`. The menu builds its items from `entityActionsFor(entity, ctx)`, with `run` mapped by key to its existing `onEdit/onMove/onCopy/onDelete` props, and gains an optional `ctx` prop that it forwards.
  - Card:
    - Add a button row (`role="group" aria-label="Actions"`, `data-testid="map-details-actions"`) above the footer. Each button is `data-testid={`map-details-action-${key}`}`, uses `min-h-6 px-2 text-xs`, and danger buttons use `text-danger`.
    - The footer hint is derived from `actions`, so it can never disagree with the menu.
    - Delete two-step uses the same local `confirmingDelete` pattern as the menu.
    - `fixedGeography` is removed as a card prop; callers pass `actions` instead.
  - Delete `FixedGeographyActionMenu`. The pmedian arm renders `MapActionMenu` with `ctx={{ fixedGeography }}`, keeping testids `map-action-menu` / `map-action-edit`.
  - In each of the four non-Super arms, pass `actions={entityActionsFor(selected, ctx)}` and `onAction={key => handlers[key](selected)}`. Reuse the arm's existing menu handlers (pmedian :752-777, transport :1264-1285, twoEchelon :1764-1785, jade :2336-2356). Refactor them to take the entity as a parameter instead of reading `actionMenu.entity`, so the menu and the card share them; this is the minimal change. Clicking a card action closes the card first, as the menu closes itself.
  - Super:
    - Left-click opens a `MapDetailsCard` (new `selected` state; positioned via the shared `placeCard` from DU-3.2 once that lands — until then the current click-point placement).
    - Pass `actions={entityActionsFor(entity, { readOnly })}` and the existing `startEdit` / `setArmedMove` / copy / `onRequestDelete` handlers.
    - Pass `confirmDelete={false}` (D3: Super's delete opens its own cascade dialog).
    - Clear the selection on map click, move/zoom, Escape and right-click, as the other arms do.

- [ ] **Step 4: Rewrite the tests, run them, then sweep.**
  - Update `MapDetailsCard.test.tsx:158,164`: the footer strings are now derived (base `"Right-click for Edit · Copy"`, fixed geography `"Right-click for Edit"`).
  - Update `InputMapTab.deliveryFixedGeography.test.tsx:173-190` to the derived footer, and add a card-button path (`map-details-action-edit` reaches the status edit).
  - `InputMapV2.integration.test.tsx`:
    - add a touch path: left-click, then `map-details-action-move` arms the move;
    - add a base entity: no move or delete button.
  - `SuperInputMap.test.tsx`:
    - left-click opens the card;
    - `map-details-action-delete` calls `onRequestDelete` on the first click;
    - in read-only mode, the card has no actions.
  - e2e: rg `map-details-footer|Right-click for|map-action-` and update any literal.

  Run typecheck, studio test and `typecheck:e2e`.

- [ ] **Step 5: Review and commit.**
  - Run `ponytail-review`.
  - Commit `[DU-3.1] one entity action list feeds menu, card buttons and hint; Super gets the details card`.
  - The changelog notes Q1 (the optional ctx) and Q7 (the gold fixed mine is unchanged).

---

### Task DU-3.2: Input Map selection ring; card close button; marker-anchored placement

**Files:**
- Modify:
  - `components/workspace/map/EntityMarkers.tsx`: new `selectedKey?: string` prop; ring in the icon builders.
  - `components/workspace/map/MapDetailsCard.tsx`: close button; uses `placeCard`.
  - The five arms (`InputMapTab.tsx` ×4, `SuperInputMap.tsx`): pass `selectedKey` and the marker anchor point.
- Create: `components/workspace/map/placeCard.ts`, `__tests__/placeCard.test.ts`.
- Test: `__tests__/EntityMarkers.test.tsx`, `__tests__/MapDetailsCard.test.tsx`.

**Interfaces:**
```ts
// components/workspace/map/placeCard.ts
export interface Point { x: number; y: number }
export interface Size { width: number; height: number }
/** DU-3.2 — top-left for a card of `card` size near `anchor` (the MARKER's container point) inside `container`,
 *  never intersecting the marker's box (`markerBox` px square centred on anchor) and keeping `gap` px clear of it.
 *  Preference: right-below, then left-below, right-above, left-above; clamp to 4px if nothing fits. */
export function placeCard(anchor: Point, card: Size, container: Size | undefined, markerBox = 32, gap = 24):
  { left: number; top: number; flippedX: boolean; flippedY: boolean };
```
- `selectedKey` is `` `${kind}:${id}` ``, so selecting a warehouse doesn't ring a customer with the same id.
- The ring is the existing Output Map pattern: `<circle r="11" fill="none" stroke="var(--map-ring-select)" stroke-width="2">` (`NetworkMap.tsx:75-89`), and icons grow from 22 to 32 px while selected.

- [ ] **Step 1: Write the failing tests**

`__tests__/placeCard.test.ts`:
```ts
const card = { width: 224, height: 190 }, box = 32, gap = 24, C = { width: 800, height: 600 };
const rect = (p: { left: number; top: number }) => ({ l: p.left, t: p.top, r: p.left + card.width, b: p.top + card.height });
const markerRect = (a: { x: number; y: number }) => ({ l: a.x - box / 2 - gap, t: a.y - box / 2 - gap, r: a.x + box / 2 + gap, b: a.y + box / 2 + gap });
const overlaps = (a: any, b: any) => a.l < b.r && a.r > b.l && a.t < b.b && a.b > b.t;
it.each([[100, 100], [790, 100], [100, 590], [790, 590], [400, 300]])("never covers the marker at (%i,%i)", (x, y) => {
  const p = placeCard({ x, y }, card, C, box, gap);
  expect(overlaps(rect(p), markerRect({ x, y }))).toBe(false);
});
it("prefers right-below when it fits", () => {
  const p = placeCard({ x: 100, y: 100 }, card, C);
  expect(p.flippedX || p.flippedY).toBe(false);
  expect(p.left).toBeGreaterThan(100);
});
it("flips left near the right edge", () => expect(placeCard({ x: 790, y: 100 }, card, C).flippedX).toBe(true));
```

`EntityMarkers.test.tsx`: with `selectedKey="wh:W1"`, W1's icon HTML contains `var(--map-ring-select)` and has size 32, while W2 has neither. Also check `cs:` and `pl:` keys, and that a customer with id `W1` is not ringed.

`MapDetailsCard.test.tsx`:
- a close button `map-details-close` (`aria-label="Close"`, `min-h-6 min-w-6`) calls `onClose`;
- the card's position comes from `placeCard`, so it isn't the click point plus 14.

- [ ] **Step 2: Run them and confirm they fail.**

- [ ] **Step 3: Implement.**
  - Write `placeCard`.
  - `MapDetailsCard` calls it with `containerPoint`, which callers now set to the marker anchor, `{ width: CARD_WIDTH, height: CARD_HEIGHT }` and `containerSize`.
    - Its `data-flipped-*` come from the result.
    - Measure the real card height after mount with `ref.offsetHeight`, falling back to `CARD_HEIGHT`. The action row from DU-3.1 makes it taller.
  - In each arm, compute the anchor as `map.latLngToContainerPoint([lat, lng])` from the selected entity. The Leaflet map comes from the existing `MapEventsBridge` / `useMap` pattern. Recompute it on selection only; move and zoom already clear the card.
  - Add `selectedKey` to `EntityMarkers` and thread it into `warehouseIcon`, `plantIcon` and `customerIcon`. Customers get a ring of `r + 3` around the bubble.

- [ ] **Step 4: Rewrite the tests.**
  - `MapDetailsCard.test.tsx:134,169` flip tests: drive them with anchor points.
  - rg the `e2e/` specs for `map-details-card` placement assumptions (`input-map-v2.spec.ts:383-388` only checks visibility).

  Run typecheck, studio test and `typecheck:e2e`.

- [ ] **Step 5: Review and commit.** Commit `[DU-3.2] Input Map selection ring; card close button; card placed off the selected marker`.

---

### Task DU-3.3: Output filter dims both legs; filter-aware narrative

**Files:**
- Modify:
  - `components/NetworkMap.tsx:552-559,610-640,712-750,781-799,848-849,888-896`: both-leg focus, plus a new `onWarehouseSelectionChange?(id: string | null)` callback.
  - `components/workspace/tabs/OutputMapTab.tsx:232-242,496-519`: holds the selection id and feeds the narrative.
  - `lib/resultNarrative.ts`: `NarrativeContext.selectedWarehouseId?`.
- Create: `lib/warehouseFigures.ts`, `__tests__/warehouseFigures.test.ts`.
- Test: `__tests__/NetworkMap.test.tsx` (new filter cases), `__tests__/resultNarrative.test.ts`, `__tests__/OutputMapTab.test.tsx`.

**Interfaces:**
```ts
// lib/warehouseFigures.ts
export interface WarehouseFigures {
  customers: number;            // distinct outbound toIds
  demandServed: number;         // sum of outbound edge flow
  avgDistance: number | null;   // flow-weighted mean outbound distance (canonical)
  farthest: { customerId: string; distance: number } | null;
  feedingPlantIds: string[];    // distinct inbound fromIds into this warehouse (multi-echelon), sorted
}
export function warehouseFigures(result: SolveResult, warehouseId: string): WarehouseFigures;
```
`isInboundLeg` from `lib/legPalette.ts` decides the legs. Outbound edges are the non-inbound edges with `fromId === warehouseId`; inbound edges are those with `toId === warehouseId`.

- [ ] **Step 1: Write the failing tests**

`warehouseFigures.test.ts`, using the narrative fixtures (`__tests__/fixtures/narrative/*.json` and `fixtures/superResult.json`):
- On p-median-us, the selected open warehouse's customers and demand match a hand-computed sum over its outbound edges, which the test computes with an inline filter and reduce;
- avg = Σ(flow·distance)/Σflow;
- feeding plants are empty;
- on JADE and super, feeding plants equal the distinct `plant_to_warehouse` `fromId`s into it;
- an unknown id gives zeros and nulls.

`NetworkMap.test.tsx`:
- **Warehouse click:** after clicking warehouse A, render the route Polylines (react-leaflet isn't mocked for Polyline; assert via the mocked Tooltip props or the polyline `pathOptions` captured by a spy):
  - its outbound and inbound lanes keep opacity 0.75;
  - every other lane, including inbound lanes into other warehouses, has opacity 0.1.
- **Customer select (Q3):** the selected customer's lane and the inbound lanes into its serving warehouse stay bright; all others dim.
- **Callback:** `onWarehouseSelectionChange` fires with A, then with null on re-click.

`resultNarrative.test.ts`:
- With `selectedWarehouseId`, the text is the warehouse-scoped sentence, using the template `"{Warehouse City, ST} serves {customers} customers — {demandServed} {demandUnit} of demand, about {avgDistance} {unit} on average; the farthest is {Customer City, ST} at {farthest} {unit}."` (placeholders, not real figures). The test computes the expected string from the fixture via `warehouseFigures`; never hardcode numbers.
- On JADE it adds `"It is fed from Plant A, Plant B."`.
- No cost token appears (assert no `$`).
- Without a selection, the output is byte-identical to today.

- [ ] **Step 2: Run them and confirm they fail.**

- [ ] **Step 3: Implement.**
  - `NetworkMap`:
    - `connectedToFocus(edge)`. With a warehouse filter, an outbound edge counts when `fromId === sel` and an inbound edge when `toId === sel`. With a customer selection, an outbound edge counts when `toId === sel`, and an inbound edge when `toId === servingWarehouse(sel)`.
    - `dimmed = anySelection && !connectedToFocus(edge)`, applied to inbound lanes too, which removes the `!isInboundEdge` exemption at :712-713.
    - Plants not connected to the focus dim to the existing 0.25 icon opacity.
    - Call `onWarehouseSelectionChange` whenever `selectedWarehouseId` changes.
  - `OutputMapTab`: hold `selectedWarehouseId` from the callback and pass it into `buildResultNarrative`'s ctx. The demand unit comes from `chapterForModelId(modelId)?.demandUnit` (DU-2.3), and names come from `nameById`.
  - `resultNarrative`: when `ctx.selectedWarehouseId` is set, return the warehouse sentence built from `warehouseFigures`, formatted with `formatDistanceDisplay` and `demandUnit`, and the band lens isn't used. Otherwise run the existing per-model branches unchanged.

- [ ] **Step 4: Rewrite the tests and sweep.**
  - rg `e2e/` for `output-map-narrative` and the dimming expectations. `design-upgrade-p2.spec.ts:767-781` asserts the narrative shape with no selection, so it should hold unchanged.

  Run typecheck, studio test and `typecheck:e2e`.

- [ ] **Step 5: Review and commit.** Commit `[DU-3.3] output warehouse filter dims both legs; narrative follows the selection`.

---

### Task DU-3.4: Popup hygiene, per-product routes, legend yields, reachable "Unverified"

**Files:**
- Modify:
  - `components/NetworkMap.tsx:241-326,821-834,899-912`: tooltip suppression, product rows in `PopupInfo` / `buildCustomerPopupHtml`, legend fade.
  - `components/workspace/map/MapLegend.tsx`: `dimmed?: boolean` prop.
  - `components/workspace/tabs/CostSummaryTab.tsx:210,625,859-862` and `pages/Landing.tsx:216-224`: info button plus Popover.
- Create:
  - `lib/productRoutes.ts` and `__tests__/productRoutes.test.ts`;
  - `components/UnverifiedInfo.tsx` (button + `Popover`, reusing `components/ui/popover.tsx`).
- Test: `__tests__/NetworkMap.test.tsx`, `__tests__/MapLegend.test.tsx`, `__tests__/CostSummaryTab.test.tsx:459-504`, `__tests__/Landing.test.tsx:225-243`.

**Interfaces:**
```ts
// lib/productRoutes.ts
export interface ProductRoute {
  productId: string; productName: string;
  warehouseId: string; outboundDistance: number;           // canonical
  plants: { plantId: string; flow: number; distance: number }[];   // inbound into warehouseId for productId, by flow desc
}
/** DU-3.4 — per-product route for one customer (multi-product models: details.assignments carry productId;
 *  plant_to_warehouse edges carry productId). [] for single-product results. */
export function productRoutesFor(result: SolveResult, dataset: Dataset, customerId: string): ProductRoute[];
```
- `PopupInfo` gains `products?: { name: string; warehouse: string; plants: string; outbound: string; inbound: string }[]`, pre-formatted strings for the HTML popup.
- `MapLegend` gains `dimmed?: boolean`, which gives `opacity-15 transition-opacity`.
- `<UnverifiedInfo />` renders a 24px `button[aria-label="Why unverified?"]`, testid `button-unverified-info`, plus a `PopoverContent` with `UNVERIFIED_TOOLTIP`, testid `popover-unverified`.

- [ ] **Step 1: Write the failing tests**
  - `productRoutes.test.ts` (JADE fixture with assignments; `superResult.json`):
    - a customer with 2 products gives 2 routes, each carrying the assignment's warehouse and distance;
    - `plants` are the inbound `plant_to_warehouse` edges with the same `productId` into that warehouse, sorted by flow, descending;
    - a single-product p-median result gives `[]`.
  - `NetworkMap.test.tsx`:
    - **Tooltip suppression:** after clicking customer C (popup open), the customer Tooltip for C is not rendered (via the mocked Tooltip calls); other customers' tooltips still are.
    - **Product rows:** on JADE, the popup HTML contains one row per product, with `Product · Warehouse City, ST · from Plant City, ST`. Distances are `formatDistanceDisplay` plus the unit, and the inbound band comes from `labelBands`.
    - **Legend fade:** firing `tooltipopen` on the map sets `MapLegend` `dimmed` (class `opacity-15`), and `tooltipclose` restores it.
  - `CostSummaryTab` and `Landing`:
    - "Unverified" has no `title` attribute;
    - `button-unverified-info` is present with an `aria-label`, and clicking it shows `popover-unverified` with `UNVERIFIED_TOOLTIP`;
    - keyboard focus plus Enter opens it, and Escape closes it.

- [ ] **Step 2: Run them and confirm they fail.**

- [ ] **Step 3: Implement.**
  - **Tooltip suppression:** don't render the customer `<Tooltip>` when `selectedCustomerId === c.id`.
  - **Product rows:** build `products` in the popup-info memo from `productRoutesFor`, then render a compact rows block in `buildCustomerPopupHtml`. HTML-escape every name; the popup is an HTML string.
  - **Legend fade:** a small `useMapEvents` listener (`tooltipopen`, `tooltipclose`, `popupopen`, `popupclose`) keeps an `overlayOpen` counter or boolean. Pass `dimmed={overlayOpen}` to the output `MapLegend` (`corner="br"`).
  - **`UnverifiedInfo`:** replace the `title` usages:
    - `CostSummaryTab` single-row: render `{value} <UnverifiedInfo/>` when `resultQualityTitle(result)` is set;
    - `CostSummaryTab` compare cell;
    - Landing badge.

    Keep the word "Unverified", and drop `resultQualityTitle`'s `title` plumbing (`CostSummaryTab.tsx:210` `r.title`) if nothing else uses it.

- [ ] **Step 4: Rewrite the tests and sweep.**
  - rg `e2e/` for `.leaflet-popup-content`, `badge-legacy-unverified` and `title=`. `jade-ch9-workspace-bundle.spec.ts:373-390` asserts the popup range text and stays valid.

  Run typecheck, studio test and `typecheck:e2e`.

- [ ] **Step 5: Review and commit.** Commit `[DU-3.4] popup hides its own tooltip, lists per-product routes; legend yields to tooltips; Unverified reachable by tap and keyboard`.

---

### Task DU-3.5: Phase 3 real-browser QA, including touch (qa-sdet)

**Files:**
- Create: `artifacts/studio/e2e/design-upgrade-p3.spec.ts`.
- Reuse: `e2e/helpers/seedSolvedResult.ts`, `solvedModelInputs.ts`, `fixtures/solved/*.json`.
- Modify: sibling specs broken by Phase 3; the changelog; the flake registry.

- [ ] **Step 1: Bring up the local servers.** Use free ports, per `artifacts/studio/e2e/CLAUDE.md`.

- [ ] **Step 2: Write `design-upgrade-p3.spec.ts`.** It iterates the Input-Map-capable chapters. Every check must be able to fail: assert locator counts > 0 first, and add an injected-probe case for each detector.
  - **Touch parity:** in a `test.use({ hasTouch: true, isMobile: true, viewport: { width: 820, height: 1180 } })` block (tablet):
    - `tap()` a base warehouse, then `map-details-actions` shows Edit and Copy only;
    - tap an added entity, then all four;
    - tapping `map-details-action-move` arms the move (`armed-status-bar`);
    - the delivery chapter shows Edit only;
    - Super: a tap opens the card.
    - Never use right-click in this block.
  - **Keyboard:**
    - open the card, Tab reaches `map-details-action-edit`, and Enter opens the edit dialog;
    - Escape closes the card and returns focus.
  - **Hint truth:** the card footer text equals `"Right-click for " + the visible action labels` for base, added and fixed-geography entities.
  - **Ring:** the selected marker's icon contains a `--map-ring-select` stroke, and no other marker does.
  - **Placement:** the card's bounding box doesn't intersect the selected marker's box padded by 24px. Measure near each map edge by panning or by picking markers near the edges.
  - **Close:** `map-details-close` hides the card.
  - **Output filter:**
    - click an open warehouse on gold, JADE and super;
    - every SVG path in `.leaflet-route-pane` not connected to it has computed `stroke-opacity` 0.1, on both legs;
    - connected lanes are 0.75;
    - the narrative text contains the warehouse's name and no `$`;
    - re-clicking restores the narrative text.
  - **Popup hygiene:**
    - click a customer and assert no `.leaflet-tooltip` for it is visible while `.leaflet-popup` is open;
    - JADE popup rows list each product with a warehouse and a plant;
    - the legend computes opacity ≤ 0.2 while a tooltip is shown and returns to 1 after.
  - **Unverified:**
    - with a seeded legacy-unverified result, tapping `button-unverified-info` shows `popover-unverified`;
    - the keyboard (Tab + Enter) shows it too;
    - no `title` attribute on the word.

- [ ] **Step 3: Sibling sweep and the full gate.**
  - Grep `e2e/` for every changed testid and string: `map-details-footer`, `Right-click for`, `map-action-`, `map-details-close`, `output-map-narrative`, `.leaflet-popup-content`, `badge-legacy-unverified`.
  - Run `E2E_BASE_URL=… pnpm e2e:gate`, including the new spec.
  - Fix stale specs. If a failure exposes a real product bug, STOP and report it.

- [ ] **Step 4: Screenshots.** Save these to the scratchpad and review them:
  - the card with actions on a tablet viewport;
  - the selection ring;
  - the dimmed both-leg filter on JADE;
  - a JADE product popup;
  - the faded legend;
  - the Unverified popover.

- [ ] **Step 5: Commit.**
  - Commit `[DU-3.5] Phase 3 real-browser QA incl. touch viewport + sibling sweep`.
  - Stop the servers by PID.
  - The lead dispatches the fable reviewer.

---

## Phase 3 close-out

1. Message the Super Model session.
2. Run `pnpm gate` serially, then `E2E_BASE_URL=… pnpm e2e:gate`.
3. Run `/harness-retro DU-3`, filling the DU-2 `merged_sha` lagging field.
4. Run `superpowers:finishing-a-development-branch`.
5. STOP and ask for merge approval. Push and deploy are separate approvals.

## Self-review

**Spec coverage:**

| Spec item | Task(s) |
|---|---|
| §5.3.1 (touch/keyboard parity) | DU-3.1 (buttons, keyboard), DU-3.5 (touch viewport) |
| §5.3.2 (truthful hint) | DU-3.1 (hint derived from the one list) |
| §5.3.3 (selection, close, placement) | DU-3.2 |
| §5.3.4 (filter both legs, narrative) | DU-3.3 |
| §5.3.4 (tooltip suppression, product popup, inbound band via the shared lens) | DU-3.4 |
| Deferred from Phase 2 | DU-3.4 (legend overlap: Q5; Unverified reachability: Q6) |

**Fixed interface:** `entityActionsFor` keeps its master §A name, location and one-argument form. Q1's optional `ctx` is additive.

**New interfaces:** `EntityAction`, `placeCard`, `warehouseFigures`, `productRoutesFor`, `MapLegend.dimmed`, `NetworkMap.onWarehouseSelectionChange` and `UnverifiedInfo` are each named in their own task.

**No invented figures:** `warehouseFigures` derives only from result edges, and no per-warehouse cost is stated (grounding: none exists in any envelope).
