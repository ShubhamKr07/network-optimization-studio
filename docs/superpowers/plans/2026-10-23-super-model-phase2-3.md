# Super Model — Phases 2–3 + Input Map Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. In this repo, dispatch follows `AGENTS.md` (agent-team roles; pre-created locked worktree per task, never `isolation: "worktree"`), and every engineering role runs `karpathy-guidelines` + `ponytail` before writing code (CLAUDE.md hard rule #12).

**Goal:** Give `super-model` an editable Input Map (D5), browser-side CSV/XLSX network import/export (D6), and OpenRouteService road distances (D7–D9), without changing any other model's behaviour.

**Architecture:** The Input Map is a new `SuperInputMap` component behind one delegating line in `InputMapTab.tsx`; every map edit is a pure function in `studio/src/lib/superNetwork.ts` over `localInputs`, saved by the existing Save. CSV/XLSX never reach the API: a new `studio/src/lib/superFiles.ts` turns files into the §3.2 network document and back, and the API's only Phase-2 change is a structured `issues` array on the network-import 422. Road distances are a synchronous owner-scoped route that calls ORS with no row lock, then writes only `roadDistances` onto the current row through `applyScenarioInputWrite`; one server function `validRoadPairs` decides validity for precheck and the solve payload, and Python only receives valid pairs.

**Tech Stack:** React + Vite + react-leaflet (vitest + RTL), papaparse, one XLSX library + fflate (chosen in Task 4), Express 5 + Drizzle + Zod (vitest + supertest, real Postgres), OpenAPI + Orval, Python 3 + PuLP (pytest), Playwright.

**Spec:** `docs/superpowers/specs/2026-10-23-super-model-design.md` at `38e9d4aa` — §6.1 (D5), §7 (D6), §8 (D7–D9), §9 phases 2–3, §10. Phase 1 plan: `docs/superpowers/plans/2026-10-23-super-model-phase1.md`; what landed: `docs/CHANGELOG-implementation.md` entries SM-1..SM-17, SM-D.

**Branching:** bundle branch `super-model-2` off current `main` (assert `git merge-base --is-ancestor origin/main main` first). Each task: `git worktree add --lock /Users/shubhamkr/nos-sm2-<n> -b sm2-<n>-work <base-sha>`; the agent's first Bash command is `cd /Users/shubhamkr/nos-sm2-<n> && git rev-parse --abbrev-ref HEAD` (must print `sm2-<n>-work`, else STOP). A fresh worktree needs `pnpm install --offline --frozen-lockfile` (SM-10 note). The lead cherry-picks each task commit onto `super-model-2` and re-gates.

## Global Constraints

- Model id `super-model`; every change below is scoped to it. No other model's code path, test expectation or `e2e_accuracy.py` value changes (hard rule #2; `e2e_accuracy.py` stays 99/99, unmodified).
- **Fit rules (§6.1):** on first render of the map view and after each successful import, `fitBounds` over every plant, warehouse and customer point (all statuses), padding **40 px**, max zoom **10**; exactly one point ⇒ `setView(point, 8)`; no points ⇒ world view (`setView([20, 0], 2)`). Add / move / copy / delete never refit. The Super map has no `maxBounds` (any lat/lng is valid).
- **New-location IDs (§6.1):** first free `PL-n` / `WH-n` / `C-n` (n = 1, 2, …), unique across plants + warehouses + customers. Edit keeps `id` read-only.
- **Copy (§6.1):** next free ID of that kind, name suffixed `" (copy)"`, **0.05° east** (`lng + 0.05`, clamped to 180). Customer copy copies its `demand` rows; plant copy copies its `plantProducts` rows; `distanceOverrides` are never copied.
- **Demand inputs:** a blank or `0` per-product demand writes no `demand` row. A new plant gets no `plantProducts` rows.
- **CSV file names (§7.2):** `products.csv`, `plants.csv`, `warehouses.csv`, `customers.csv`, `plant_products.csv`, `demand.csv`, `distance_overrides.csv`, `parameters.csv`. XLSX sheet names = the same minus `.csv`. Unknown names rejected by name. One kind per import: a set of `.csv`, or one `.xlsx`, or one `.json`.
- **Parameters keys, exactly:** `p`, `gap`, `timeLimitSec`, `distanceMethod`, `circuityFactor`, `transportCosts.icTransCost`, `transportCosts.icMinTrans`, `transportCosts.obTransCost`, `transportCosts.obMinTrans`. Header `key,value`. Values numeric except `distanceMethod`. Unknown or duplicate key = error; absent or empty value = absent from the document.
- **Cell rules (§7.2):** ID/text columns read as text (XLSX numeric `101` → `"101"`), trimmed; numeric columns must be finite numbers; XLSX date and error cells are errors; XLSX formula cell uses its cached value, none = error; empty optional (`city`, `state`, `status`) omitted; empty required = error; fully empty row skipped.
- **Formula guard:** CSV export uses `clientCsv.ts` `csvCell` (text starting `=`, `+`, `-`, `@`, tab, CR gets a leading `'`); CSV import removes a leading `'` that is followed by one of those characters. XLSX writes typed cells, never formulas; no prefix added or stripped.
- **422 `issues` (§7.1):** `{ path: (string|number)[], message }` alongside `error`. Studio maps `path[0]` → file/sheet, `path[1]` → file row `path[1] + 2` (header is row 1; see deviation 1 for skipped empty rows), `path[2]` → column. JSON imports keep showing `error`.
- **`MAX_IMPORT_BYTES`** (`lib/import-schema/src/index.ts:24`, 2 MiB = 2,097,152 B) applies to the serialized JSON request for every format; the Studio checks it before posting.
- **ORS (§8, D9):** `POST https://api.openrouteservice.org/v2/matrix/driving-hgv`, header `Authorization: <ORS_API_KEY>`, body `{ locations: [[lng, lat], …], sources: [i…], destinations: [j…], metrics: ["distance"], units: "mi" }` — **[longitude, latitude]**. Response `distances[s][d]` miles, `null` = unroutable. Miles stored unrounded.
- **ORS limits:** ≤ **3,500** origin×destination pairs per request; free key **500** matrix requests/day, **40**/minute. Request 1 = all plants × all warehouses; then customers in chunks of **`floor(3500 / warehouses)`**, each chunk × all warehouses as sources. Serial. ≤ 9 requests at the §3.3 caps (50 WH ⇒ chunks of 70 ⇒ 8 customer requests).
- **Timeouts:** **30 s** `AbortSignal.timeout` per request; **120 s** deadline for the whole fetch (one shared `AbortController`). No retries. One process-wide queue.
- **Error codes (closed union, one task):** `road_distances_unavailable | road_distances_quota | road_distances_failed | road_distances_unroutable`. HTTP status (plan choice, spec silent — open issue 7): 503 / 429 / 502 / 422.
- **Road validity (D8):** only `validRoadPairs(inputs)` (API server) decides it; Python and Studio never recompute it.
- `ORS_API_KEY`: `sync: false` on `nos-api` in `render.yaml`; never logged or returned; tests never call ORS (injected `fetch`).
- Hard rules: never hand-edit `lib/api-zod/src/generated/` or `lib/api-client-react/src/generated/` (#1, regen with `pnpm --filter @workspace/api-spec run codegen`); ownership + 404 on every scenario route (#5); solver business rules as data, not branches (#6); one task = one commit `[SM2-<n>] <imperative>` (#4); every commit on its own branch, never `main`.
- Verification gate per task: `pnpm gate` (exit 3 = timeout, re-run serially; exit 1 = real failure); solver-touching tasks also `cd artifacts/api-server/src/solver/tests && python3 e2e_accuracy.py` (99/99). Before trusting vitest: `cnt=$(ps aux | grep "[v]itest" | grep -v "zsh -c" | wc -l | tr -d ' '); [ "$cnt" = "0" ] || exit 1` (never chain with `&&`). Known flakes: `docs/superpowers/flake-registry.md` (match by name, re-run twice in isolation).
- DB tests: `DATABASE_URL="postgresql://shubhamkr@localhost:5432/nos_dev"` inline per command.
- Commit guard before every commit: `[ "$(git rev-parse --abbrev-ref HEAD)" != "main" ] || { echo "ON MAIN — commit refused"; exit 1; }`; commit with an explicit pathspec. Each task appends its changelog entry to `docs/CHANGELOG-implementation.md` in the same commit (hard rule #9).

## File Structure

| File | Status | Responsibility | Task |
|---|---|---|---|
| `artifacts/studio/src/components/workspace/map/mapControls.tsx` | create | `MapEventsBridge`, `GhostFollower`, `AddEntityMenu`, `ToggleChip`, `LayerCheckbox`, `OverlayAnchor` moved verbatim out of `InputMapTab.tsx` | 1 |
| `artifacts/studio/src/components/workspace/tabs/InputMapTab.tsx` | modify | import the moved controls; `mode: "super"` variant that only delegates | 1, 2 |
| `artifacts/studio/src/components/workspace/super/SuperInputMap.tsx` | create | Super map: projection, markers, legend, layers, fit; then add/edit/move/copy/delete | 1, 2 |
| `artifacts/studio/src/components/workspace/super/SuperEntityDialog.tsx` | create | create + edit for plant / warehouse / customer, per-product demand | 2 |
| `artifacts/studio/src/lib/superNetwork.ts` | modify | `superTablesEmpty`, map projection, `nextFreeId`, `addLocation`, `editLocation`, `moveLocation`, `copyLocation` | 1, 2 |
| `artifacts/studio/src/pages/Workspace.tsx` | modify | input-map entry, seeding, switch-to-map + refit after import, map mount, Save gate, export menu, road dialog, payload strip | 1, 2, 5, 10 |
| `artifacts/api-server/src/validation/formatInputIssues.ts` | modify | `InputIssue`, `toInputIssues`; `roadDistances` label | 3, 7 |
| `artifacts/api-server/src/registry/modelRegistry.ts` | modify | failure result carries `issues` | 3 |
| `artifacts/api-server/src/services/scenarioInputWrite.ts` | modify | `invalid` outcome carries `issues`; `dropClientOwnedInputs`; `roadDistances` keep/clear/set | 3, 7 |
| `artifacts/api-server/src/services/superNetwork.ts` | modify | `mergeNetwork` returns an origin map; `toDocIssues` | 3 |
| `artifacts/api-server/src/routes/superNetwork.ts` | modify | 422 `issues`; replace clears / merge keeps road; export strips road; road route | 3, 7, 9 |
| `artifacts/studio/src/lib/superFiles.ts` | create | CSV/XLSX → document, document → CSV zip / XLSX, issue → file/row/column text | 4 |
| `artifacts/studio/src/lib/clientCsv.ts` | modify | `downloadBlob` | 4 |
| `artifacts/studio/package.json`, `pnpm-lock.yaml` | modify | `papaparse`, `@types/papaparse`, XLSX library, `fflate` | 4 |
| `artifacts/studio/src/components/workspace/super/SuperNetworkImportDialog.tsx` | modify | multi-file input, kind detection, size check, `issues` display | 5 |
| `artifacts/studio/src/components/workspace/super/SuperReadinessPanel.tsx` | modify | CSV/XLSX template + sample downloads; road fetch action | 5, 10 |
| `artifacts/api-server/src/validation/inputs/superInputs.ts` | modify | `road` method, `roadDistancesSchema`, persisted `roadDistances` | 7 |
| `solvers/super-model/manifest.json` | modify | `distanceMethod` enum gains `road`; `roadDistances` property | 7 |
| `artifacts/api-server/src/routes/scenarios.ts` | modify | POST `/scenarios` drops client `roadDistances` | 7 |
| `artifacts/api-server/src/services/superRoad.ts` | create | `validRoadPairs`, `missingRequiredRoadPairs` | 8 |
| `artifacts/api-server/src/services/precheckSuper.ts` | modify | road readiness item | 8 |
| `artifacts/api-server/src/solver/pmedian.ts` | modify | super payload: drop `roadDistances`, pass `roadPairs` | 8 |
| `artifacts/api-server/src/solver/merge_inputs.py` | modify | resolution step 2 (`roadPairs`) | 8 |
| `artifacts/api-server/src/services/orsClient.ts` | create | batches, fetch, timeouts, queue, error codes, test seam | 9 |
| `lib/api-spec/openapi.yaml` (+ regenerated `lib/api-zod`, `lib/api-client-react`) | modify | `NetworkImportRejection`; road route + `RoadDistancesErrorCode` | 3, 9 |
| `artifacts/studio/src/components/workspace/super/SuperRoadDistancesDialog.tsx` | create | privacy notice, fetch, error messages | 10 |
| `artifacts/studio/src/components/workspace/super/SuperDistancesTab.tsx` | modify | `road` option + fetch button | 10 |
| `render.yaml` | modify | `ORS_API_KEY` `sync: false` | 6 |
| `artifacts/studio/e2e/super-model.spec.ts` | modify | SM-13 opening + switch-to-map (Task 1); Phase 2 browser flows (Task 11) | 1, 11 |
| `docs/CHANGELOG-implementation.md` | modify | one entry per task | all |

## Registration map (`model-integration-precheck.md`, 18 points + gates)

| Point / gate | This work | Task |
|---|---|---|
| 1 Manifest | `distanceMethod` enum `+road`, `roadDistances` property (no `required[]` change — WF-5 gotcha: adding to `properties` only is safe) | 7 |
| 2 Dataset version | unchanged — the sha covers `dataset/*` only (`computeSha256`, `lib/dataset-schema/src/index.ts:205`), not the manifest | — |
| 3 Zod schema / `KNOWN_SCHEMAS` | `superInputs.ts` gains `road` + `roadDistances`; registry failure result gains `issues` | 3, 7 |
| 4 `VALID_MODEL_IDS` | unchanged — Phase 1 | — |
| 5 `PACKAGE_SPECS` | unchanged — Phase 1 | — |
| 6 Payload builder | `pmedian.ts:217-219` drops `roadDistances`, adds `roadPairs` | 8 |
| 7 OpenAPI | no `modelId` enum change; new schemas + path; regenerated clients | 3, 9 |
| 8 Dispatcher | unchanged; `merge_inputs.py` `build_super_dataset` gains step 2 (`SOLVER_CODE_HASH` already hashes `merge_inputs.py`, SM-2, so cached results invalidate once) | 8 |
| 9 Override entity import/export | unchanged — Super stays off the per-entity routes (`superModelRegistration.test.ts` "per-entity import/export routes keep rejecting super-model") | — |
| 10 Studio.tsx multi-select | unchanged — legacy Studio page, not the Workspace | — |
| 11 Objective dimension | unchanged — Phase 1 (`monetary`) | — |
| 12 `inputEntriesForModel` | Super case gains `input-map` first | 1 |
| 13 Precheck dispatcher | unchanged dispatch; `precheckSuperInputs` gains the road item | 8 |
| 14 Router mount | unchanged — the road route lives in the already-mounted `routes/superNetwork.ts`, which `lockedModelGuards.test.ts` already scans (SM-16) | 9 |
| 15 `buildEffectiveFacilityCityLookup` | unchanged — Phase 1 | — |
| 16 `pMax` | unchanged — Phase 1 | — |
| 17 `registration.test.ts` / `superModelRegistration.test.ts` | "road ⇒ 422" inverted | 7 |
| 18 `MODEL_IDS` | unchanged | — |
| Gate 5 contract & caching | metrics unchanged; contract changes ship with their regen in one commit | 3, 9 |
| Gate 6.5 InputMapTab variant | `mode: "super"` → `SuperInputMap` | 1 |
| Gate 6.5 symbology | reuse `EntityMarkers` / `MapLegend` / `statusPresentation.ts` (plant square, warehouse triangle by status, customer bubble) | 1 |
| Gate 6.5 effective-row projection | `superMapRows` from `localInputs` (no base dataset) | 1 |
| Gate 6.5 added-entity identity | Super row `id` IS the marker `displayCode`; IDs `PL-n` / `WH-n` / `C-n`; no `newUid`/`displayCode` field (§6.1) | 2 |
| Gate 6.5 auto-estimate distances | not applicable — spec §3.3, Super is not in `normalizeAddedEntityDistances` | — |
| Gate 6.5 save reconciliation | generic; Super map edits use the toolbar Save (`SUPER_INPUT_TABS`) | 2 |
| Gate 6.5 move/delete never re-key | move writes lat/lng only; delete uses the D3 cascade | 2 |
| Gate 7 tests | per task below; `e2e_accuracy.py` + `e2e_journey.py super` unchanged and green | 8, 11 |
| Gate 8 rollout | `ORS_API_KEY` is a new deploy-checklist env var; no `lib/db/src/schema/**` change | 6, 12 |

---

### Task 1 [SM2-1]: Super Input Map wiring, read-only map with fit and layers

Role: frontend-engineer. (Also edits `artifacts/studio/e2e/super-model.spec.ts`, normally qa-sdet's; spec §6.1 puts that update in this task.)

**Files:**
- Create: `artifacts/studio/src/components/workspace/map/mapControls.tsx` (verbatim move of `InputMapTab.tsx:343-394` `OverlayAnchor`/`MapEventsBridge`/`GhostFollower`, `:395-454` `AddEntityMenu`, `:531-557` `ToggleChip`, `:574-614` `LayerCheckbox`, each now `export`ed)
- Modify: `artifacts/studio/src/components/workspace/tabs/InputMapTab.tsx:1-20` (import the moved controls), `:129` (union gains `mode: "super"`), `:322-327` (dispatcher)
- Create: `artifacts/studio/src/components/workspace/super/SuperInputMap.tsx`
- Modify: `artifacts/studio/src/lib/superNetwork.ts` (add `SUPER_TABLE_KEYS`, `superTablesEmpty`, `superMapRows`)
- Modify: `artifacts/studio/src/pages/Workspace.tsx:1273-1285` (`input-map` entry), `:2441-2449` (seed effect), `:2764-2770` (use the lib's `superTablesEmpty`), `:3376` (map mount), `:4609` (readiness panel not on the map), `:4710-4717` (import → map)
- Modify: `artifacts/studio/src/__tests__/Workspace.TabCoverage.test.tsx:893-900`, `artifacts/studio/src/__tests__/Workspace.Super.test.tsx:125-130, 210-216`
- Create: `artifacts/studio/src/__tests__/SuperInputMap.test.tsx`
- Modify: `artifacts/studio/e2e/super-model.spec.ts:54-64` (`importSampleViaUi`)

**Interfaces:**
- Produces (`lib/superNetwork.ts`):
  ```ts
  export const SUPER_TABLE_KEYS: readonly SuperTable[];
  export function superTablesEmpty(inputs: Record<string, unknown> | null | undefined): boolean;
  export interface SuperMapRows { plants: MapPlant[]; warehouses: MapWarehouse[]; customers: MapCustomer[] }
  export function superMapRows(inputs: SuperInputsLike): SuperMapRows;
  ```
- Produces (`InputMapTab.tsx` union member, Task 2 widens it):
  ```ts
  { mode: "super"; inputs: SuperInputsLike; fitKey: number }
  ```
- Produces (`SuperInputMap.tsx`): `export function SuperInputMap(props: Extract<InputMapTabProps, { mode: "super" }>): ReactNode` and `export function FitToPoints({ points, fitKey }: { points: [number, number][]; fitKey: number }): null`.
- Consumes: `EntityMarkers` (`map/EntityMarkers.tsx:69-92`, `modelId` required), `MapLegend` (`map/MapLegend.tsx:64`), `InvalidateOnResize`.

- [ ] **Step 1: Failing tests.** `src/__tests__/SuperInputMap.test.tsx`:

```tsx
import { describe, it, expect, vi, afterEach } from "vitest";
import { render as rtlRender, screen, fireEvent } from "@testing-library/react";
import L from "leaflet";
import { UnitProvider } from "@/contexts/UnitContext";
import { InputMapTab } from "@/components/workspace/tabs/InputMapTab";
import { superMapRows, type SuperInputsLike } from "@/lib/superNetwork";

const render = (ui: Parameters<typeof rtlRender>[0]) => rtlRender(ui, { wrapper: UnitProvider });
vi.mock("@workspace/api-client-react", () => ({ useListModels: () => ({ data: [] }) }));

const net = (over: Partial<SuperInputsLike> = {}): SuperInputsLike => ({
  products: [{ id: "K1", name: "K1" }, { id: "K2", name: "K2" }],
  plants: [{ id: "PL-1", name: "Plant", city: "Ashland", state: "KY", lat: 38.4, lng: -82.6 }],
  warehouses: [{ id: "WH-1", name: "Wh", lat: 33.4, lng: -112.0, status: "forced_open" },
               { id: "WH-2", name: "Wh2", lat: 40.0, lng: -75.0, status: "inactive" }],
  customers: [{ id: "C-1", name: "Cust", lat: 34.0, lng: -118.2, status: "excluded" }],
  plantProducts: [], demand: [{ customerId: "C-1", productId: "K1", demand: 5 }, { customerId: "C-1", productId: "K2", demand: 7 }],
  distanceOverrides: [],
  ...over,
});
afterEach(() => vi.restoreAllMocks());

describe("superMapRows", () => {
  it("projects rows with id as displayCode, every row scenario-owned, demand summed", () => {
    const r = superMapRows(net());
    expect(r.plants[0]).toMatchObject({ id: "PL-1", displayCode: "PL-1", city: "Ashland", isAdded: true });
    expect(r.warehouses.map(w => w.status)).toEqual(["forced_open", "inactive"]);
    expect(r.customers[0]).toMatchObject({ displayCode: "C-1", demand: 12, excluded: true, city: "", isAdded: true });
  });
});

describe("InputMapTab mode=super", () => {
  it("renders the super toolbar, legend and one marker per location", () => {
    const { container } = render(<InputMapTab mode="super" inputs={net()} fitKey={0} />);
    expect(screen.getByTestId("super-map-toolbar")).toBeInTheDocument();
    expect(screen.getByTestId("map-legend")).toBeInTheDocument();
    expect(screen.queryByTestId("jade-map-toolbar")).not.toBeInTheDocument();
    // showInactive defaults true for Super, so all statuses render
    expect(container.querySelectorAll(".leaflet-marker-pane .leaflet-marker-icon")).toHaveLength(4);
  });
  it("layer toggles hide plants / warehouses / customers", () => {
    const { container } = render(<InputMapTab mode="super" inputs={net()} fitKey={0} />);
    fireEvent.click(screen.getByTestId("toggle-layer-plants"));
    expect(container.querySelector(".pl-marker")).toBeNull();
    fireEvent.click(screen.getByTestId("toggle-layer-warehouses"));
    expect(container.querySelector(".wh-marker")).toBeNull();
    fireEvent.click(screen.getByTestId("toggle-layer-customers"));
    expect(container.querySelector(".cs-marker")).toBeNull();
  });
  it("fits all points on mount (40 px, max zoom 10) and refits only when fitKey changes", () => {
    const fit = vi.spyOn(L.Map.prototype, "fitBounds").mockImplementation(function (this: L.Map) { return this; });
    const { rerender } = render(<InputMapTab mode="super" inputs={net()} fitKey={0} />);
    expect(fit).toHaveBeenCalledTimes(1);
    expect(fit.mock.calls[0][0]).toHaveLength(4);
    expect(fit.mock.calls[0][1]).toEqual({ padding: [40, 40], maxZoom: 10 });
    const moved = net({ plants: [{ id: "PL-1", name: "Plant", lat: 10, lng: 10 }] });
    rerender(<UnitProvider><InputMapTab mode="super" inputs={moved} fitKey={0} /></UnitProvider>);
    expect(fit).toHaveBeenCalledTimes(1);
    rerender(<UnitProvider><InputMapTab mode="super" inputs={moved} fitKey={1} /></UnitProvider>);
    expect(fit).toHaveBeenCalledTimes(2);
  });
  it("one point -> setView(point, 8); no points -> world view", () => {
    const view = vi.spyOn(L.Map.prototype, "setView");
    const one = net({ plants: [], warehouses: [], customers: [{ id: "C-1", name: "c", lat: 34, lng: -118, status: "active" }] });
    render(<InputMapTab mode="super" inputs={one} fitKey={0} />);
    expect(view).toHaveBeenCalledWith([34, -118], 8);
    view.mockClear();
    render(<InputMapTab mode="super" inputs={net({ plants: [], warehouses: [], customers: [] })} fitKey={0} />);
    expect(view).toHaveBeenCalledWith([20, 0], 2);
  });
});
```

  `Workspace.TabCoverage.test.tsx:894-899` becomes:

```tsx
  it("lists exactly the ten Super Model input tabs, Input Map first", () => {
    expect(inputEntriesForModel("super-model").map(e => e.label)).toEqual([
      "Input Map", "Products", "Plants", "Warehouses", "Customers", "Plant Capability",
      "Demand", "Distances", "Transportation Costs", "Optimization Parameters",
    ]);
  });
```

  `Workspace.Super.test.tsx`: the "nine sidebar input entries" test loops over `["input-map", "products", …]` (ten ids, retitled "ten"); add after the SM-13 test:

```tsx
  it("SM2-1: a non-empty scenario opens on the Input Map", () => {
    renderWorkspace();
    expect(screen.getByTestId("super-map-toolbar")).toBeInTheDocument();
  });
  it("SM2-1: an empty scenario's Input Map shows the map, not the import prompt", () => {
    const empty = { ...scenario, inputs: { ...sample, products: [], plants: [], warehouses: [], customers: [], plantProducts: [], demand: [], distanceOverrides: [] } };
    mockUseGetScenario.mockReturnValue({ data: empty } as unknown as ReturnType<typeof mockUseGetScenario>);
    mockUseListScenarios.mockReturnValue({ data: [empty] } as unknown as ReturnType<typeof mockUseListScenarios>);
    renderWorkspace();
    expect(screen.getByTestId("super-open-import")).toBeInTheDocument(); // SM-13 unchanged
    fireEvent.click(screen.getByTestId("sidebar-input-input-map"));
    expect(screen.getByTestId("super-map-toolbar")).toBeInTheDocument();
    expect(screen.queryByTestId("super-empty-state")).not.toBeInTheDocument();
  });
  it("SM2-1: a successful import switches to the Input Map", async () => {
    const { useImportScenarioNetwork } = await import("@workspace/api-client-react");
    vi.mocked(useImportScenarioNetwork).mockReturnValue({
      mutate: (_v: unknown, o: { onSuccess: (r: { scenario: typeof scenario }) => void }) => o.onSuccess({ scenario }),
      reset: vi.fn(), isPending: false, isError: false,
    } as never);
    renderWorkspace();
    fireEvent.click(screen.getByTestId("sidebar-input-products"));
    fireEvent.click(screen.getByTestId("super-header-import"));
    fireEvent.click(screen.getByTestId("super-import-mode-merge"));
    fireEvent.change(screen.getByTestId("super-import-file"), { target: { files: [new File(["{}"], "n.json", { type: "application/json" })] } });
    await waitFor(() => expect(screen.getByTestId("super-import-confirm")).not.toBeDisabled());
    fireEvent.click(screen.getByTestId("super-import-confirm"));
    await waitFor(() => expect(screen.getByTestId("super-map-toolbar")).toBeInTheDocument());
  });
```

- [ ] **Step 2: Run, expect FAIL** (`mode="super"` unknown; no `input-map` entry):
  `pnpm --filter studio exec vitest run src/__tests__/SuperInputMap.test.tsx src/__tests__/Workspace.Super.test.tsx src/__tests__/Workspace.TabCoverage.test.tsx`

- [ ] **Step 3: Move the controls.** Cut `OverlayAnchor` (`InputMapTab.tsx:343`), `MapEventsBridge`, `GhostFollower`, `AddEntityMenu`, `ToggleChip`, `LayerCheckbox` (with their comments, unchanged) into `map/mapControls.tsx`, prefix each with `export`, carry the imports they use (`useEffect, useRef, useState, type ReactNode` from react, `CircleMarker, useMapEvents` from react-leaflet, `type L` from leaflet, `Checkbox`). In `InputMapTab.tsx` add:

```tsx
import { MapEventsBridge, GhostFollower, AddEntityMenu, ToggleChip, LayerCheckbox, type OverlayAnchor } from "@/components/workspace/map/mapControls";
import { SuperInputMap } from "@/components/workspace/super/SuperInputMap";
import type { SuperInputsLike } from "@/lib/superNetwork";
```

  Pure move: the existing InputMapTab suites are the regression proof.

- [ ] **Step 4: Union + dispatcher** (`InputMapTab.tsx:129`, `:322`):

```tsx
  | {
      /** SM2-1 — Super Model: every row is scenario-owned; all logic lives in SuperInputMap. */
      mode: "super";
      inputs: SuperInputsLike;
      /** Refit trigger: Workspace increments it after each successful import (§6.1 fit rules). */
      fitKey: number;
    }
```
```tsx
  if (props.mode === "super") return <SuperInputMap {...props} />;
```

- [ ] **Step 5: `lib/superNetwork.ts` additions:**

```ts
import type { MapCustomer, MapPlant, MapWarehouse } from "@/components/workspace/map/types";
import type { WhStatus } from "@/components/workspace/map/statusPresentation";

export const SUPER_TABLE_KEYS: readonly SuperTable[] = ["products", "plants", "warehouses", "customers", "plantProducts", "demand", "distanceOverrides"];
export function superTablesEmpty(inputs: Record<string, unknown> | null | undefined): boolean {
  return !!inputs && SUPER_TABLE_KEYS.every(k => !Array.isArray(inputs[k]) || (inputs[k] as unknown[]).length === 0);
}

export interface SuperMapRows { plants: MapPlant[]; warehouses: MapWarehouse[]; customers: MapCustomer[] }
const str = (v: unknown) => (typeof v === "string" ? v : "");
/** Every Super row is scenario-owned (isAdded: true => full action set); the row id IS the marker code. */
export function superMapRows(inputs: SuperInputsLike): SuperMapRows {
  const demand = new Map<string, number>();
  for (const d of inputs.demand) demand.set(String(d.customerId), (demand.get(String(d.customerId)) ?? 0) + Number(d.demand ?? 0));
  const base = (r: Row) => ({ id: String(r.id), displayCode: String(r.id), city: str(r.city), state: str(r.state), lat: Number(r.lat), lng: Number(r.lng), isAdded: true });
  return {
    plants: inputs.plants.map(base),
    warehouses: inputs.warehouses.map(r => ({ ...base(r), status: (r.status ?? "active") as WhStatus })),
    customers: inputs.customers.map(r => ({ ...base(r), demand: demand.get(String(r.id)) ?? 0, excluded: r.status === "excluded" })),
  };
}
```

- [ ] **Step 6: `SuperInputMap.tsx`** (read-only here; Task 2 adds actions):

```tsx
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { MapContainer, TileLayer, useMap } from "react-leaflet";
import { EntityMarkers, type EntityMarkersToggles } from "@/components/workspace/map/EntityMarkers";
import { MapLegend } from "@/components/workspace/map/MapLegend";
import { InvalidateOnResize } from "@/components/workspace/map/InvalidateOnResize";
import { LayerCheckbox } from "@/components/workspace/map/mapControls";
import { superMapRows } from "@/lib/superNetwork";
import type { InputMapTabProps } from "@/components/workspace/tabs/InputMapTab";

const WORLD: [number, number] = [20, 0];
const NO_DRAG = new Set<string>();

/** §6.1 fit rules. Runs on mount and when fitKey changes, never on point edits (points are read through a ref). */
export function FitToPoints({ points, fitKey }: { points: [number, number][]; fitKey: number }): null {
  const map = useMap();
  const pointsRef = useRef(points);
  pointsRef.current = points;
  useEffect(() => {
    const pts = pointsRef.current;
    if (pts.length === 0) map.setView(WORLD, 2);
    else if (pts.length === 1) map.setView(pts[0], 8);
    else map.fitBounds(pts, { padding: [40, 40], maxZoom: 10 });
  }, [map, fitKey]);
  return null;
}

export function SuperInputMap({ inputs, fitKey }: Extract<InputMapTabProps, { mode: "super" }>): ReactNode {
  const rows = useMemo(() => superMapRows(inputs), [inputs]);
  const [toggles, setToggles] = useState<EntityMarkersToggles>({ plants: true, warehouses: true, customers: true, showInactive: true, sizeByDemand: false });
  const points = useMemo<[number, number][]>(
    () => [...rows.plants, ...rows.warehouses, ...rows.customers].map(l => [l.lat, l.lng]), [rows]);
  const flip = (k: "plants" | "warehouses" | "customers") => setToggles(t => ({ ...t, [k]: !(t[k] ?? true) }));
  return (
    <div className="h-full flex flex-col gap-2" data-testid="input-map-tab">
      <div className="flex items-center gap-2 flex-wrap flex-shrink-0" data-testid="super-map-toolbar">
        <span className="text-xs text-muted-foreground">Layers:</span>
        <LayerCheckbox testId="toggle-layer-plants" checked={toggles.plants ?? true} onToggle={() => flip("plants")}>Plants</LayerCheckbox>
        <LayerCheckbox testId="toggle-layer-warehouses" checked={toggles.warehouses} onToggle={() => flip("warehouses")}>Warehouses</LayerCheckbox>
        <LayerCheckbox testId="toggle-layer-customers" checked={toggles.customers} onToggle={() => flip("customers")}>Customers</LayerCheckbox>
      </div>
      <div className="flex-1 min-h-0 relative">
        <MapContainer center={WORLD} zoom={2} className="h-full w-full" scrollWheelZoom>
          <InvalidateOnResize />
          <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="© OpenStreetMap contributors" />
          <FitToPoints points={points} fitKey={fitKey} />
          <EntityMarkers plants={rows.plants} warehouses={rows.warehouses} customers={rows.customers} toggles={toggles}
            onLeftClick={() => {}} onRightClick={() => {}} onDragEnd={() => {}} draggableIds={NO_DRAG} modelId="super-model" />
        </MapContainer>
        <MapLegend customers={rows.customers} showWarehouseLayer={toggles.warehouses} showCustomerLayer={toggles.customers}
          sizeByDemand={false} showPlantLayer={toggles.plants ?? true} />
      </div>
    </div>
  );
}
```

  `showInactive: true` so every status renders (fit covers all statuses; inactive keep the dashed triangle).

- [ ] **Step 7: Workspace wiring.**
  - `:1274` Super case: first entry `{ id: "input-map", label: "Input Map" },`.
  - Replace the component-local `SUPER_TABLE_KEYS`/`superTablesEmpty` (`:2765-2767`) with the lib import (`import { cascadeDelete, referencingRows, superTablesEmpty, type SuperInputsLike, type SuperTable } from "@/lib/superNetwork";`); `superIsEmpty` / `superSavedIsEmpty` keep their definitions.
  - Seed effect (`:2446-2447`):
```tsx
    // SM-13 / SM2-1 — an empty super scenario opens on the import prompt (first table tab); a non-empty one on the Input Map.
    const entry = modelId === "super-model"
      ? entries.find(e => e.id === (superTablesEmpty(currentScenario.inputs as Record<string, unknown>) ? "products" : "input-map"))
      : entries.find(e => e.id === "input-map");
```
  - State next to `superImportOpen`: `const [superFitKey, setSuperFitKey] = useState(0);` and
```tsx
  // SM2-1 (§6.1) — after any successful Super import: resync like every import, open the Input Map, refit.
  function handleSuperImportApplied(updated: Scenario) {
    handleImportApplied(updated);
    openTab("input", { id: "input-map", label: "Input Map" });
    setSuperFitKey(k => k + 1);
  }
```
    and `onApplied={handleSuperImportApplied}` at `:4716`.
  - `:3376`, first lines inside the input-map branch:
```tsx
      if (modelId === "super-model") {
        if (!localInputs) return <span className="text-muted-foreground" data-testid="tab-content-loading">Loading…</span>;
        return <InputMapTab mode="super" inputs={localInputs as SuperInputsLike} fitKey={superFitKey} />;
      }
```
  - `:4609`: `(superIsEmpty && activeView.entity !== "input-map") || activeView.entity === "optimization-parameters"` (an empty scenario's Input Map shows the world view so a network can be built on the map). `isEmpty` passed to the panel stays `superIsEmpty`; on optimization-parameters with an empty draft the panel still shows the empty state as before.

- [ ] **Step 8: e2e update.** `importSampleViaUi` (`e2e/super-model.spec.ts:62`) gains, after the empty-state assertion:
```ts
  // SM2-1 (§6.1): a successful import switches to the Input Map.
  await expect(page.getByTestId("super-map-toolbar")).toBeVisible({ timeout: HEADER_TIMEOUT });
```
  Tests A/B/C already navigate by sidebar after import; no other edit.

- [ ] **Step 9: Run** the three vitest files (PASS), then every existing `InputMapTab*`/`InputMapV2*` suite: `pnpm --filter studio exec vitest run src/__tests__/InputMapTab src/__tests__/InputMapV2 src/__tests__/Workspace.InputMapV2.test.tsx` (PASS, proves the move). Start both servers per `artifacts/studio/e2e/CLAUDE.md` and run `E2E_BASE_URL=http://localhost:<studio-port> pnpm --filter studio exec playwright test e2e/super-model.spec.ts` (A, B, C PASS). Then `pnpm gate`.

- [ ] **Step 10: Commit** on `sm2-1-work`:
```bash
[ "$(git rev-parse --abbrev-ref HEAD)" != "main" ] || { echo "ON MAIN — commit refused"; exit 1; }
git add artifacts/studio/src/components/workspace/map/mapControls.tsx artifacts/studio/src/components/workspace/super/SuperInputMap.tsx artifacts/studio/src/__tests__/SuperInputMap.test.tsx
git commit artifacts/studio/src/components/workspace/map/mapControls.tsx artifacts/studio/src/components/workspace/tabs/InputMapTab.tsx artifacts/studio/src/components/workspace/super/SuperInputMap.tsx artifacts/studio/src/lib/superNetwork.ts artifacts/studio/src/pages/Workspace.tsx artifacts/studio/src/__tests__/SuperInputMap.test.tsx artifacts/studio/src/__tests__/Workspace.Super.test.tsx artifacts/studio/src/__tests__/Workspace.TabCoverage.test.tsx artifacts/studio/e2e/super-model.spec.ts docs/CHANGELOG-implementation.md -m "[SM2-1] add the super-model Input Map view with fit rules and import switch"
```

---

### Task 2 [SM2-2]: Input Map editing — SuperEntityDialog, add / edit / move / copy / delete

Role: frontend-engineer.

**Files:**
- Modify: `artifacts/studio/src/lib/superNetwork.ts` (mutators)
- Create: `artifacts/studio/src/components/workspace/super/SuperEntityDialog.tsx`
- Modify: `artifacts/studio/src/components/workspace/super/SuperInputMap.tsx`, `artifacts/studio/src/components/workspace/tabs/InputMapTab.tsx` (union member widened)
- Modify: `artifacts/studio/src/pages/Workspace.tsx:1269` (`SUPER_INPUT_TABS` gains `"input-map"`), the Task-1 map mount
- Modify: `artifacts/studio/src/__tests__/superNetwork.test.ts`, `artifacts/studio/src/__tests__/SuperInputMap.test.tsx`, `artifacts/studio/src/__tests__/Workspace.Super.test.tsx`
- Create: `artifacts/studio/src/__tests__/SuperEntityDialog.test.tsx`

**Interfaces:**
- Consumes: Task 1's `superMapRows`, `SuperInputMap`; `cascadeDelete`/`referencingRows` (`lib/superNetwork.ts:18-27`); `MapActionMenu` (`map/MapActionMenu.tsx:10-24`, all four actions because `isAdded: true`); `MoveConfirmDialog` (`map/dialogs/MoveConfirmDialog.tsx:14-28`); `AddEntityMenu` (`map/mapControls.tsx`).
- Produces (`lib/superNetwork.ts`):
  ```ts
  export type LocKind = "pl" | "wh" | "cs";
  export const LOC_TABLE: { pl: "plants"; wh: "warehouses"; cs: "customers" };
  export interface LocationDraft { id: string; name: string; city?: string; state?: string; lat: number; lng: number; status?: string }
  export function nextFreeId(inputs: SuperInputsLike, kind: LocKind): string;
  export function demandOf(inputs: SuperInputsLike, customerId: string): Record<string, number>;
  export function addLocation(inputs: SuperInputsLike, kind: LocKind, row: LocationDraft, demand?: Record<string, number>): SuperInputsLike;
  export function editLocation(inputs: SuperInputsLike, kind: LocKind, row: LocationDraft, demand?: Record<string, number>): SuperInputsLike;
  export function moveLocation(inputs: SuperInputsLike, kind: LocKind, id: string, lat: number, lng: number): SuperInputsLike;
  export function copyLocation(inputs: SuperInputsLike, kind: LocKind, id: string): SuperInputsLike;
  ```
- Produces (union member, final shape):
  ```ts
  { mode: "super"; inputs: SuperInputsLike; fitKey: number;
    onInputsChange: (next: SuperInputsLike) => void;
    onRequestDelete: (table: "plants" | "warehouses" | "customers", id: string) => void;
    readOnly: boolean }
  ```
- Produces: `SuperEntityDialog` props `{ mode: "create" | "edit"; kind: LocKind; initial: LocationDraft; initialDemand: Record<string, number>; products: { id: string; name: string }[]; takenIds: Set<string>; onSubmit(row: LocationDraft, demand: Record<string, number>): void; onCancel(): void }`. Test ids `super-entity-dialog`, `super-entity-id`, `super-entity-name`, `super-entity-city`, `super-entity-state`, `super-entity-status`, `super-entity-demand-<productId>`, `super-entity-error`, `super-entity-submit`, `super-entity-cancel`.

- [ ] **Step 1: Failing mutator tests** (append to `src/__tests__/superNetwork.test.ts`):

```ts
import { addLocation, copyLocation, editLocation, moveLocation, nextFreeId, type SuperInputsLike } from "@/lib/superNetwork";

const n = (): SuperInputsLike => ({
  products: [{ id: "K1", name: "K1" }, { id: "K2", name: "K2" }],
  plants: [{ id: "PL-1", name: "P", lat: 1, lng: 2 }],
  warehouses: [{ id: "WH-1", name: "W", lat: 3, lng: 4, status: "active" }],
  customers: [{ id: "C-1", name: "C", lat: 5, lng: 6, status: "active" }, { id: "PL-2", name: "odd", lat: 0, lng: 0, status: "active" }],
  plantProducts: [{ plantId: "PL-1", productId: "K1", capacity: 9, costPerUnit: 1 }],
  demand: [{ customerId: "C-1", productId: "K1", demand: 4 }],
  distanceOverrides: [{ fromId: "PL-1", toId: "WH-1", miles: 3 }, { fromId: "WH-1", toId: "C-1", miles: 2 }],
});

describe("SM2-2 map mutators", () => {
  it("nextFreeId is the first free n across all location tables", () => {
    expect(nextFreeId(n(), "pl")).toBe("PL-3");   // PL-2 is taken by a customer (global uniqueness, §3.3)
    expect(nextFreeId(n(), "wh")).toBe("WH-2");
    expect(nextFreeId(n(), "cs")).toBe("C-2");
  });
  it("addLocation writes the row and only positive demand rows; a plant gets no plantProducts", () => {
    const a = addLocation(n(), "cs", { id: "C-9", name: "New", city: "", lat: 7, lng: 8, status: "active" }, { K1: 0, K2: 3 });
    expect(a.customers.at(-1)).toEqual({ id: "C-9", name: "New", lat: 7, lng: 8, status: "active" });
    expect(a.demand.filter(d => d.customerId === "C-9")).toEqual([{ customerId: "C-9", productId: "K2", demand: 3 }]);
    const p = addLocation(n(), "pl", { id: "PL-3", name: "P3", lat: 1, lng: 1 });
    expect(p.plantProducts).toEqual(n().plantProducts);
  });
  it("editLocation keeps id and coordinates, replaces the customer's demand rows", () => {
    const e = editLocation(n(), "cs", { id: "C-1", name: "Renamed", lat: 99, lng: 99, status: "excluded" }, { K2: 5 });
    expect(e.customers[0]).toEqual({ id: "C-1", name: "Renamed", lat: 5, lng: 6, status: "excluded" });
    expect(e.demand).toEqual([{ customerId: "C-1", productId: "K2", demand: 5 }]);
  });
  it("moveLocation writes lat/lng only", () => {
    expect(moveLocation(n(), "wh", "WH-1", 10, 20).warehouses[0]).toEqual({ id: "WH-1", name: "W", lat: 10, lng: 20, status: "active" });
  });
  it("copy: next id, ' (copy)', 0.05° east, copies demand / plantProducts, never overrides", () => {
    const c = copyLocation(n(), "cs", "C-1");
    expect(c.customers.at(-1)).toEqual({ id: "C-2", name: "C (copy)", lat: 5, lng: 6.05, status: "active" });
    expect(c.demand).toContainEqual({ customerId: "C-2", productId: "K1", demand: 4 });
    const p = copyLocation(n(), "pl", "PL-1");
    expect(p.plantProducts).toContainEqual({ plantId: "PL-3", productId: "K1", capacity: 9, costPerUnit: 1 });
    expect(p.distanceOverrides).toEqual(n().distanceOverrides);
    expect(copyLocation({ ...n(), warehouses: [{ id: "WH-1", name: "W", lat: 0, lng: 179.99, status: "active" }] }, "wh", "WH-1").warehouses.at(-1)!.lng).toBe(180);
  });
});
```

- [ ] **Step 2: Failing dialog + map tests.** `src/__tests__/SuperEntityDialog.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SuperEntityDialog } from "@/components/workspace/super/SuperEntityDialog";

const products = [{ id: "K1", name: "Bolts" }, { id: "K2", name: "Nuts" }];
const base = { mode: "create" as const, kind: "cs" as const, initial: { id: "C-2", name: "", lat: 1, lng: 2, status: "active" },
  initialDemand: {}, products, takenIds: new Set(["C-1", "WH-1"]), onCancel: vi.fn() };

describe("SuperEntityDialog", () => {
  it("create: pre-filled id, one demand input per product, blank demand omitted", () => {
    const onSubmit = vi.fn();
    render(<SuperEntityDialog {...base} onSubmit={onSubmit} />);
    expect(screen.getByTestId("super-entity-id")).toHaveValue("C-2");
    fireEvent.change(screen.getByTestId("super-entity-name"), { target: { value: "Acme" } });
    fireEvent.change(screen.getByTestId("super-entity-demand-K2"), { target: { value: "12" } });
    fireEvent.click(screen.getByTestId("super-entity-submit"));
    expect(onSubmit).toHaveBeenCalledWith({ id: "C-2", name: "Acme", lat: 1, lng: 2, status: "active" }, { K2: 12 });
  });
  it("rejects a taken id, a blank name and a negative demand", () => {
    const onSubmit = vi.fn();
    render(<SuperEntityDialog {...base} onSubmit={onSubmit} />);
    fireEvent.change(screen.getByTestId("super-entity-id"), { target: { value: "WH-1" } });
    fireEvent.click(screen.getByTestId("super-entity-submit"));
    expect(screen.getByTestId("super-entity-error")).toHaveTextContent("already used");
    fireEvent.change(screen.getByTestId("super-entity-id"), { target: { value: "C-5" } });
    fireEvent.click(screen.getByTestId("super-entity-submit"));
    expect(screen.getByTestId("super-entity-error")).toHaveTextContent("Name is required");
    fireEvent.change(screen.getByTestId("super-entity-name"), { target: { value: "A" } });
    fireEvent.change(screen.getByTestId("super-entity-demand-K1"), { target: { value: "-1" } });
    fireEvent.click(screen.getByTestId("super-entity-submit"));
    expect(screen.getByTestId("super-entity-error")).toHaveTextContent("Bolts");
    expect(onSubmit).not.toHaveBeenCalled();
  });
  it("edit: id is read-only; a plant shows no status and no demand", () => {
    render(<SuperEntityDialog {...base} mode="edit" kind="pl" initial={{ id: "PL-1", name: "P", lat: 1, lng: 2 }} onSubmit={vi.fn()} />);
    expect(screen.getByTestId("super-entity-id")).toHaveAttribute("readonly");
    expect(screen.queryByTestId("super-entity-status")).not.toBeInTheDocument();
    expect(screen.queryByTestId("super-entity-demand-K1")).not.toBeInTheDocument();
  });
});
```

  Append to `SuperInputMap.test.tsx` (the `render` helper now passes the new props: `onInputsChange={vi.fn()} onRequestDelete={vi.fn()} readOnly={false}` on every existing call):

```tsx
const mount = (inputs = net(), readOnly = false) => {
  const onInputsChange = vi.fn(), onRequestDelete = vi.fn();
  const view = render(<InputMapTab mode="super" inputs={inputs} fitKey={0} onInputsChange={onInputsChange} onRequestDelete={onRequestDelete} readOnly={readOnly} />);
  return { ...view, onInputsChange, onRequestDelete };
};
const markers = (c: HTMLElement) => c.querySelectorAll(".leaflet-marker-pane .leaflet-marker-icon");

describe("SuperInputMap actions", () => {
  it("right-click empty map -> Add warehouse here -> dialog pre-filled WH-3 -> onInputsChange", () => {
    const { container, onInputsChange } = mount();
    fireEvent.contextMenu(container.querySelector(".leaflet-container")!, { clientX: 40, clientY: 40 });
    fireEvent.click(screen.getByTestId("map-add-menu-wh"));
    expect(screen.getByTestId("super-entity-id")).toHaveValue("WH-3");
    fireEvent.change(screen.getByTestId("super-entity-name"), { target: { value: "New WH" } });
    fireEvent.click(screen.getByTestId("super-entity-submit"));
    expect(onInputsChange.mock.calls[0][0].warehouses.at(-1)).toMatchObject({ id: "WH-3", name: "New WH", status: "active" });
  });
  it("Edit on a customer opens the dialog with its demand; submit replaces demand rows", () => {
    const { container, onInputsChange } = mount();
    fireEvent.contextMenu(markers(container)[3]);       // order: plants, warehouses, customers
    fireEvent.click(screen.getByTestId("map-action-edit"));
    expect(screen.getByTestId("super-entity-demand-K2")).toHaveValue(7);
    fireEvent.change(screen.getByTestId("super-entity-demand-K2"), { target: { value: "" } });
    fireEvent.click(screen.getByTestId("super-entity-submit"));
    expect(onInputsChange.mock.calls[0][0].demand).toEqual([{ customerId: "C-1", productId: "K1", demand: 5 }]);
  });
  it("Copy inserts immediately 0.05° east with no placement click and no refit", () => {
    const fit = vi.spyOn(L.Map.prototype, "fitBounds").mockImplementation(function (this: L.Map) { return this; });
    const { container, onInputsChange } = mount();
    const before = fit.mock.calls.length;
    fireEvent.contextMenu(markers(container)[0]);
    fireEvent.click(screen.getByTestId("map-action-copy"));
    expect(onInputsChange.mock.calls[0][0].plants.at(-1)).toMatchObject({ id: "PL-2", name: "Plant (copy)", lng: -82.55 });
    expect(fit.mock.calls.length).toBe(before);
  });
  it("Move -> click -> MoveConfirmDialog -> lat/lng written", () => {
    const { container, onInputsChange } = mount();
    fireEvent.contextMenu(markers(container)[1]);
    fireEvent.click(screen.getByTestId("map-action-move"));
    fireEvent.click(container.querySelector(".leaflet-container")!, { clientX: 20, clientY: 20 });
    fireEvent.click(screen.getByTestId("move-confirm-confirm"));
    const w = onInputsChange.mock.calls[0][0].warehouses[0];
    expect(w.id).toBe("WH-1");
    expect([w.lat, w.lng]).not.toEqual([33.4, -112.0]);
  });
  it("Delete goes to the D3 cascade confirmation via onRequestDelete, not straight to inputs", () => {
    const { container, onInputsChange, onRequestDelete } = mount();
    fireEvent.contextMenu(markers(container)[3]);
    fireEvent.click(screen.getByTestId("map-action-delete"));
    fireEvent.click(screen.getByTestId("map-action-delete"));   // MapActionMenu's own "Confirm delete?"
    expect(onRequestDelete).toHaveBeenCalledWith("customers", "C-1");
    expect(onInputsChange).not.toHaveBeenCalled();
  });
  it("readOnly: no add menu, no action menu", () => {
    const { container } = mount(net(), true);
    fireEvent.contextMenu(container.querySelector(".leaflet-container")!);
    expect(screen.queryByTestId("map-add-menu")).not.toBeInTheDocument();
    fireEvent.contextMenu(markers(container)[0]);
    expect(screen.queryByTestId("map-action-menu")).not.toBeInTheDocument();
  });
});
```

  Check the action-menu test ids against `MapActionMenu.tsx` (`map-action-edit|move|copy|delete`, as used by `InputMapTabV2.jade.test.tsx:228`) before running.

  Append to `Workspace.Super.test.tsx`:

```tsx
  it("SM2-2: deleting a customer on the map uses the cascade confirmation with its row count, and Save shows", () => {
    const { container } = renderWorkspace();
    const refs = sample.demand.filter((r: { customerId: string }) => r.customerId === "customer-1").length
      + sample.distanceOverrides.filter((r: { toId: string }) => r.toId === "customer-1").length;
    const cs = container.querySelectorAll('[data-testid="input-map-tab"] .leaflet-marker-icon.cs-marker');
    fireEvent.contextMenu(cs[0]);
    fireEvent.click(screen.getByTestId("map-action-delete"));
    fireEvent.click(screen.getByTestId("map-action-delete"));
    expect(screen.getByTestId("super-delete-count")).toHaveTextContent(`This also deletes ${refs} referencing row(s).`);
    fireEvent.click(screen.getByTestId("super-delete-confirm-button"));
    expect(screen.getByTestId("button-save")).not.toBeDisabled();
  });
```

  (`sample.customers[0].id` is `customer-1`; customers render in array order.)

- [ ] **Step 3: Run, expect FAIL:** `pnpm --filter studio exec vitest run src/__tests__/superNetwork.test.ts src/__tests__/SuperEntityDialog.test.tsx src/__tests__/SuperInputMap.test.tsx src/__tests__/Workspace.Super.test.tsx`

- [ ] **Step 4: Mutators** (append to `lib/superNetwork.ts`):

```ts
export type LocKind = "pl" | "wh" | "cs";
export const LOC_TABLE = { pl: "plants", wh: "warehouses", cs: "customers" } as const;
const PREFIX: Record<LocKind, string> = { pl: "PL-", wh: "WH-", cs: "C-" };
export interface LocationDraft { id: string; name: string; city?: string; state?: string; lat: number; lng: number; status?: string }

const locationIds = (i: SuperInputsLike) => new Set([...i.plants, ...i.warehouses, ...i.customers].map(r => String(r.id)));
export function nextFreeId(inputs: SuperInputsLike, kind: LocKind): string {
  const used = locationIds(inputs);
  for (let n = 1; ; n++) if (!used.has(`${PREFIX[kind]}${n}`)) return `${PREFIX[kind]}${n}`;
}
export function demandOf(inputs: SuperInputsLike, customerId: string): Record<string, number> {
  return Object.fromEntries(inputs.demand.filter(d => d.customerId === customerId).map(d => [String(d.productId), Number(d.demand)]));
}
/** Blank optional text is omitted, as the import does (§7.2). */
function clean(row: LocationDraft): Row {
  const out: Row = { id: row.id, name: row.name };
  if (row.city) out.city = row.city;
  if (row.state) out.state = row.state;
  out.lat = row.lat; out.lng = row.lng;
  if (row.status) out.status = row.status;
  return out;
}
const demandRows = (customerId: string, demand: Record<string, number>) =>
  Object.entries(demand).filter(([, v]) => v > 0).map(([productId, v]) => ({ customerId, productId, demand: v }));

export function addLocation(inputs: SuperInputsLike, kind: LocKind, row: LocationDraft, demand: Record<string, number> = {}): SuperInputsLike {
  const t = LOC_TABLE[kind];
  const next = { ...inputs, [t]: [...inputs[t], clean(row)] } as SuperInputsLike;
  return kind === "cs" ? { ...next, demand: [...inputs.demand, ...demandRows(row.id, demand)] } : next;
}
export function editLocation(inputs: SuperInputsLike, kind: LocKind, row: LocationDraft, demand: Record<string, number> = {}): SuperInputsLike {
  const t = LOC_TABLE[kind];
  const next = { ...inputs, [t]: inputs[t].map(r => (r.id === row.id ? clean({ ...row, lat: Number(r.lat), lng: Number(r.lng) }) : r)) } as SuperInputsLike;
  return kind === "cs" ? { ...next, demand: [...inputs.demand.filter(d => d.customerId !== row.id), ...demandRows(row.id, demand)] } : next;
}
export function moveLocation(inputs: SuperInputsLike, kind: LocKind, id: string, lat: number, lng: number): SuperInputsLike {
  const t = LOC_TABLE[kind];
  return { ...inputs, [t]: inputs[t].map(r => (r.id === id ? { ...r, lat, lng } : r)) } as SuperInputsLike;
}
export function copyLocation(inputs: SuperInputsLike, kind: LocKind, id: string): SuperInputsLike {
  const t = LOC_TABLE[kind];
  const src = inputs[t].find(r => r.id === id);
  if (!src) return inputs;
  const newId = nextFreeId(inputs, kind);
  const next = { ...inputs, [t]: [...inputs[t], { ...src, id: newId, name: `${src.name} (copy)`, lng: Math.min(180, Number(src.lng) + 0.05) }] } as SuperInputsLike;
  if (kind === "cs") next.demand = [...inputs.demand, ...inputs.demand.filter(d => d.customerId === id).map(d => ({ ...d, customerId: newId }))];
  if (kind === "pl") next.plantProducts = [...inputs.plantProducts, ...inputs.plantProducts.filter(r => r.plantId === id).map(r => ({ ...r, plantId: newId }))];
  return next;
}
```

  (Checked in node: `-82.6 + 0.05 === -82.55` and `6 + 0.05 === 6.05`, so the exact assertions hold.)

- [ ] **Step 5: `SuperEntityDialog.tsx`:**

```tsx
import { useState } from "react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type { LocKind, LocationDraft } from "@/lib/superNetwork";

const LABEL: Record<LocKind, string> = { pl: "plant", wh: "warehouse", cs: "customer" };
const STATUS: Partial<Record<LocKind, string[]>> = { wh: ["active", "forced_open", "inactive"], cs: ["active", "excluded"] };

export interface SuperEntityDialogProps {
  mode: "create" | "edit"; kind: LocKind; initial: LocationDraft; initialDemand: Record<string, number>;
  products: { id: string; name: string }[]; takenIds: Set<string>;
  onSubmit(row: LocationDraft, demand: Record<string, number>): void; onCancel(): void;
}

export function SuperEntityDialog(p: SuperEntityDialogProps) {
  const [row, setRow] = useState<LocationDraft>(p.initial);
  const [demand, setDemand] = useState<Record<string, string>>(
    Object.fromEntries(Object.entries(p.initialDemand).map(([k, v]) => [k, String(v)])));
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof LocationDraft) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setRow(r => ({ ...r, [k]: e.target.value }));

  function submit() {
    const id = row.id.trim(), name = row.name.trim();
    if (!id) return setError("ID is required.");
    if (p.mode === "create" && p.takenIds.has(id)) return setError(`ID "${id}" is already used by a plant, warehouse or customer.`);
    if (!name) return setError("Name is required.");
    const out: Record<string, number> = {};
    for (const k of p.products) {
      const raw = (demand[k.id] ?? "").trim();
      if (raw === "") continue;
      const v = Number(raw);
      if (!Number.isFinite(v) || v < 0) return setError(`Demand for ${k.name} must be a number ≥ 0.`);
      if (v > 0) out[k.id] = v;
    }
    p.onSubmit({ ...row, id, name, city: row.city?.trim() || undefined, state: row.state?.trim() || undefined }, out);
  }

  return (
    <Dialog open onOpenChange={o => !o && p.onCancel()}>
      <DialogContent data-testid="super-entity-dialog">
        <DialogHeader><DialogTitle>{p.mode === "create" ? `New ${LABEL[p.kind]}` : `Edit ${LABEL[p.kind]} ${p.initial.id}`}</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-2 text-sm">
          <label>ID<input className="w-full border rounded px-2 h-8" data-testid="super-entity-id" value={row.id} readOnly={p.mode === "edit"} onChange={set("id")} /></label>
          <label>Name<input className="w-full border rounded px-2 h-8" data-testid="super-entity-name" value={row.name} onChange={set("name")} /></label>
          <label>City<input className="w-full border rounded px-2 h-8" data-testid="super-entity-city" value={row.city ?? ""} onChange={set("city")} /></label>
          <label>State<input className="w-full border rounded px-2 h-8" data-testid="super-entity-state" value={row.state ?? ""} onChange={set("state")} /></label>
          {STATUS[p.kind] && (
            <label>Status<select className="w-full border rounded px-2 h-8" data-testid="super-entity-status" value={row.status ?? "active"} onChange={set("status")}>
              {STATUS[p.kind]!.map(s => <option key={s} value={s}>{s}</option>)}
            </select></label>
          )}
          {p.kind === "cs" && p.products.map(k => (
            <label key={k.id}>Demand — {k.name}<input type="number" min={0} className="w-full border rounded px-2 h-8" data-testid={`super-entity-demand-${k.id}`}
              value={demand[k.id] ?? ""} onChange={e => setDemand(d => ({ ...d, [k.id]: e.target.value }))} /></label>
          ))}
        </div>
        {error && <p className="text-xs text-destructive" data-testid="super-entity-error">{error}</p>}
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={p.onCancel} data-testid="super-entity-cancel">Cancel</Button>
          <Button size="sm" onClick={submit} data-testid="super-entity-submit">{p.mode === "create" ? "Add" : "Save"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

  `onSubmit`'s expected object in the first test has no `city`/`state` keys; `undefined`-valued keys satisfy `toHaveBeenCalledWith` (`toEqual` semantics). `clean()` omits them on write.

- [ ] **Step 6: Actions in `SuperInputMap.tsx`.** Replace the Task-1 no-op handlers:

```tsx
import L from "leaflet";
import { MapActionMenu } from "@/components/workspace/map/MapActionMenu";
import { MoveConfirmDialog } from "@/components/workspace/map/dialogs/MoveConfirmDialog";
import { JADE_WAREHOUSE_ROLE, PLANT_ROLE, type MapEntity } from "@/components/workspace/map/types";
import { MapEventsBridge, GhostFollower, AddEntityMenu, LayerCheckbox, type OverlayAnchor } from "@/components/workspace/map/mapControls";
import { SuperEntityDialog } from "./SuperEntityDialog";
import { LOC_TABLE, addLocation, copyLocation, demandOf, editLocation, moveLocation, nextFreeId, superMapRows, type LocKind, type LocationDraft } from "@/lib/superNetwork";

// inside SuperInputMap({ inputs, fitKey, onInputsChange, onRequestDelete, readOnly }):
  const [menu, setMenu] = useState<({ entity: MapEntity } & OverlayAnchor) | null>(null);
  const [addAt, setAddAt] = useState<({ lat: number; lng: number } & OverlayAnchor) | null>(null);
  const [dialog, setDialog] = useState<{ mode: "create" | "edit"; kind: LocKind; initial: LocationDraft; demand: Record<string, number> } | null>(null);
  const [armedMove, setArmedMove] = useState<MapEntity | null>(null);
  const [moveTo, setMoveTo] = useState<{ entity: MapEntity; lat: number; lng: number } | null>(null);
  const takenIds = useMemo(() => new Set([...rows.plants, ...rows.warehouses, ...rows.customers].map(l => l.id)), [rows]);
  const draggable = useMemo(() => (readOnly ? NO_DRAG : takenIds), [readOnly, takenIds]);
  const rowOf = (e: MapEntity) => inputs[LOC_TABLE[e.kind]].find(r => r.id === e.entity.id)!;

  function onMapClick(e: L.LeafletMouseEvent) {
    if (armedMove) { setMoveTo({ entity: armedMove, lat: e.latlng.lat, lng: e.latlng.lng }); setArmedMove(null); return; }
    setMenu(null); setAddAt(null);
  }
  function onMapContextMenu(e: L.LeafletMouseEvent) {
    if (readOnly) return;
    setMenu(null);
    setAddAt({ lat: e.latlng.lat, lng: e.latlng.lng, containerPoint: e.containerPoint });
  }
  function onMarkerRightClick(entity: MapEntity, e: L.LeafletMouseEvent) {
    if (readOnly) return;
    setAddAt(null);
    setMenu({ entity, containerPoint: e.containerPoint });
  }
  function startCreate(kind: LocKind) {
    if (!addAt) return;
    setDialog({ mode: "create", kind, demand: {}, initial: { id: nextFreeId(inputs, kind), name: "", lat: addAt.lat, lng: addAt.lng, ...(kind === "pl" ? {} : { status: "active" }) } });
    setAddAt(null);
  }
  function startEdit() {
    if (!menu) return;
    const r = rowOf(menu.entity);
    setDialog({ mode: "edit", kind: menu.entity.kind,
      initial: { id: String(r.id), name: String(r.name), city: r.city as string | undefined, state: r.state as string | undefined, lat: Number(r.lat), lng: Number(r.lng), status: r.status as string | undefined },
      demand: menu.entity.kind === "cs" ? demandOf(inputs, String(r.id)) : {} });
    setMenu(null);
  }
```

  JSX additions: `<MapEventsBridge onClick={onMapClick} onContextMenu={onMapContextMenu} onMoveOrZoomStart={() => { setMenu(null); setAddAt(null); }} />` and `{armedMove && <GhostFollower tint="#2563eb" />}` inside `MapContainer`; `EntityMarkers` gets `onRightClick={onMarkerRightClick}`, `onLeftClick={() => {}}`, `onDragEnd={(entity, ll) => setMoveTo({ entity, lat: ll.lat, lng: ll.lng })}`, `draggableIds={draggable}`; after the map:

```tsx
        {menu && (
          <MapActionMenu entity={menu.entity} containerPoint={menu.containerPoint} onClose={() => setMenu(null)}
            onEdit={startEdit}
            onMove={() => { setArmedMove(menu.entity); setMenu(null); }}
            onCopy={() => { onInputsChange(copyLocation(inputs, menu.entity.kind, menu.entity.entity.id)); setMenu(null); }}
            onDelete={() => { onRequestDelete(LOC_TABLE[menu.entity.kind], menu.entity.entity.id); setMenu(null); }} />
        )}
        {addAt && <AddEntityMenu containerPoint={addAt.containerPoint} showPlantOption onAdd={startCreate} onClose={() => setAddAt(null)} />}
      </div>
      {dialog && (
        <SuperEntityDialog mode={dialog.mode} kind={dialog.kind} initial={dialog.initial} initialDemand={dialog.demand}
          products={inputs.products.map(p => ({ id: String(p.id), name: String(p.name) }))} takenIds={takenIds}
          onCancel={() => setDialog(null)}
          onSubmit={(row, demand) => {
            onInputsChange(dialog.mode === "create" ? addLocation(inputs, dialog.kind, row, demand) : editLocation(inputs, dialog.kind, row, demand));
            setDialog(null);
          }} />
      )}
      {moveTo && (
        <MoveConfirmDialog kind={moveTo.entity.kind}
          role={moveTo.entity.kind === "wh" ? JADE_WAREHOUSE_ROLE : moveTo.entity.kind === "pl" ? PLANT_ROLE : undefined}
          entity={{ id: moveTo.entity.entity.id, displayCode: moveTo.entity.entity.displayCode }}
          newLat={moveTo.lat} newLng={moveTo.lng} existingCodes={takenIds}
          onCancel={() => setMoveTo(null)}
          onConfirm={next => { onInputsChange(moveLocation(inputs, moveTo.entity.kind, moveTo.entity.entity.id, next.lat, next.lng)); setMoveTo(null); }} />
      )}
```

  Move writes `lat`/`lng` only; the dialog's regenerated "New code" and nearest city are not written (open issue 4).

- [ ] **Step 7: Workspace.** `SUPER_INPUT_TABS` (`:1269`) gains `"input-map"` first (toolbar Save on the map; there is no Layers-row Save for Super). The Task-1 mount becomes:

```tsx
        return (
          <InputMapTab mode="super" inputs={localInputs as SuperInputsLike} fitKey={superFitKey} readOnly={isBrowsingHistoryNow}
            onInputsChange={next => { if (!isBrowsingHistoryNow) setLocalInputs(next); }}
            onRequestDelete={(table, id) => { if (!isBrowsingHistoryNow) setSuperDeleteTarget({ table, id }); }} />
        );
```

  The existing `AlertDialog` (`:4719-4740`) already computes `referencingRows` and applies `cascadeDelete` — reused as is (D3).

- [ ] **Step 8: Run** the four files (PASS), then `pnpm gate`.

- [ ] **Step 9: Commit** on `sm2-2-work`:
```bash
[ "$(git rev-parse --abbrev-ref HEAD)" != "main" ] || { echo "ON MAIN — commit refused"; exit 1; }
git add artifacts/studio/src/components/workspace/super/SuperEntityDialog.tsx artifacts/studio/src/__tests__/SuperEntityDialog.test.tsx
git commit artifacts/studio/src/lib/superNetwork.ts artifacts/studio/src/components/workspace/super/SuperEntityDialog.tsx artifacts/studio/src/components/workspace/super/SuperInputMap.tsx artifacts/studio/src/components/workspace/tabs/InputMapTab.tsx artifacts/studio/src/pages/Workspace.tsx artifacts/studio/src/__tests__/superNetwork.test.ts artifacts/studio/src/__tests__/SuperEntityDialog.test.tsx artifacts/studio/src/__tests__/SuperInputMap.test.tsx artifacts/studio/src/__tests__/Workspace.Super.test.tsx docs/CHANGELOG-implementation.md -m "[SM2-2] edit the super-model network on the Input Map"
```

---
### Task 3 [SM2-3]: Structured 422 `issues` on network import; max-size measurement

Role: backend-engineer. Contract task: OpenAPI + Orval regen land in this commit (hard rule #1; "a change crossing a layer boundary is ONE commit").

**Files:**
- Modify: `artifacts/api-server/src/validation/formatInputIssues.ts:139-142` (add `InputIssue`, `toInputIssues`)
- Modify: `artifacts/api-server/src/registry/modelRegistry.ts:130-150` (failure result gains `issues`)
- Modify: `artifacts/api-server/src/services/scenarioInputWrite.ts:35-38, 86` (`invalid` outcome gains `issues`)
- Modify: `artifacts/api-server/src/services/superNetwork.ts:19-30` (`mergeNetwork` returns `{ next, origin }`; `toDocIssues`)
- Modify: `artifacts/api-server/src/routes/superNetwork.ts:41-50`
- Modify: `lib/api-spec/openapi.yaml:461-466` (import 422) + new schemas next to `ErrorEnvelope` (`:1073`); regen `lib/api-zod/src/generated`, `lib/api-client-react/src/generated`
- Modify: `artifacts/api-server/src/__tests__/superNetworkImport.test.ts`
- Create: `artifacts/api-server/src/__tests__/superMaxSize.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // formatInputIssues.ts
  export interface InputIssue { path: (string | number)[]; message: string }
  export function toInputIssues(issues: z.ZodIssue[]): InputIssue[];
  // modelRegistry.ts
  export type ValidateInputsResult = { success: true; data: Record<string, unknown> } | { success: false; error: string; issues: InputIssue[] };
  // scenarioInputWrite.ts
  | { kind: "invalid"; error: string; issues: InputIssue[] }
  // services/superNetwork.ts
  export type MergeOrigin = Partial<Record<keyof typeof superTableSchemas, (number | null)[]>>;
  export function mergeNetwork(current: SuperInputs, doc: SuperNetworkDoc, mode: "replace" | "merge"): { next: Record<string, unknown>; origin: MergeOrigin };
  export function toDocIssues(issues: InputIssue[], origin: MergeOrigin): InputIssue[];
  ```
- Wire: network-import 422 body `{ error: string, issues: InputIssue[] }` (OpenAPI `NetworkImportRejection`). `issues` paths are **document-relative**: `path[1]` indexes the imported table's rows, never the merged table (open issue 2). An issue on a pre-existing row that the import did not mention is reported with `path: [table]` and a message prefixed `Existing <table> row <n>:`.
- Consumed by Task 5 (`describeIssue`).

- [ ] **Step 1: Failing tests** (append to `superNetworkImport.test.ts`):

```ts
  it("SM2-3: a doc-schema failure carries document-row issues", async () => {
    const id = await createEmptySuper();
    const res = await imp(id, "replace", { customers: [{ id: "c", name: "c", lat: 1, lng: 1 }, { id: "d", name: "d", lat: 999, lng: 1 }] });
    expect(res.status).toBe(422);
    expect(typeof res.body.error).toBe("string");
    expect(res.body.issues).toContainEqual(expect.objectContaining({ path: ["customers", 1, "lat"] }));
  });
  it("SM2-3: replace whole-network issues index the imported rows", async () => {
    const id = await createEmptySuper();
    const res = await imp(id, "replace", { ...sample, demand: [sample.demand[0], { customerId: "ghost", productId: "product-1", demand: 1 }] });
    expect(res.status).toBe(422);
    expect(res.body.issues).toContainEqual({ path: ["demand", 1, "customerId"], message: 'Unknown customer "ghost"' });
  });
  it("SM2-3: merge issues are translated from merged rows to imported rows", async () => {
    const id = await createEmptySuper();
    await imp(id, "replace", sample).expect(200);
    const res = await imp(id, "merge", { demand: [{ customerId: "customer-1", productId: "nope", demand: 1 }] });
    expect(res.status).toBe(422);
    // merged index is sample.demand.length (400); the document index is 0
    expect(res.body.issues).toContainEqual({ path: ["demand", 0, "productId"], message: 'Unknown product "nope"' });
    expect(res.body.issues.some((i: { path: unknown[] }) => i.path[1] === sample.demand.length)).toBe(false);
  });
```

  Non-vacuity: before Step 3 the merge test must fail on `path[1] === 400`, not only on a missing `issues` key — after implementing, temporarily return `outcome.issues` untranslated and confirm it fails; restore.

  `src/__tests__/superMaxSize.test.ts` (same register/create/imp helpers as `superNetworkImport.test.ts:21-42`, copied, prefix `sm2-3-`):

```ts
import { MAX_IMPORT_BYTES } from "@workspace/import-schema";
import { SUPER_CAPS, SUPER_DEFAULT_INPUTS, superInputsSchema } from "../validation/inputs/superInputs.js";

/** §3.3 worst case for request bytes: 20 plants, 50 warehouses, 500 customers, 2 products
 *  (50 × 500 × 2 = 50,000 = whCustProd), every plant→WH and WH→customer pair overridden (26,000),
 *  every demand cell filled, sample-style ids and full-precision floats. String lengths are
 *  unbounded in the schema, so this is a defined realistic worst case, not a proof for every network. */
function maxNetwork() {
  const f = (i: number) => Math.sqrt(i + 2) * 97.31;          // ~17 significant digits, deterministic
  const loc = (p: string, i: number) => ({ id: `${p}-${i}`, name: `${p} ${i} Springfield`, city: "Springfield", state: "MO",
    lat: 25 + (f(i) % 24), lng: -124 + (f(i + 7) % 57) });
  const plants = Array.from({ length: SUPER_CAPS.plants }, (_, i) => loc("plant", i + 1));
  const warehouses = Array.from({ length: SUPER_CAPS.warehouses }, (_, i) => ({ ...loc("wh", i + 1), status: "active" }));
  const customers = Array.from({ length: SUPER_CAPS.customers }, (_, i) => ({ ...loc("customer", i + 1), status: "active" }));
  const products = [{ id: "product-1", name: "Product 1" }, { id: "product-2", name: "Product 2" }];
  let k = 0;
  return {
    ...SUPER_DEFAULT_INPUTS, p: 10, products, plants, warehouses, customers,
    plantProducts: plants.flatMap(p => products.map(q => ({ plantId: p.id, productId: q.id, capacity: f(k++) * 1e6, costPerUnit: f(k++) }))),
    demand: customers.flatMap(c => products.map(q => ({ customerId: c.id, productId: q.id, demand: f(k++) * 100 }))),
    distanceOverrides: [
      ...plants.flatMap(a => warehouses.map(b => ({ fromId: a.id, toId: b.id, miles: f(k++) * 10 }))),
      ...warehouses.flatMap(a => customers.map(b => ({ fromId: a.id, toId: b.id, miles: f(k++) * 10 }))),
    ],
  };
}

describe("SM2-3 max-size network vs MAX_IMPORT_BYTES", () => {
  it("setup", async () => { cookie = await registerAndGetCookie(); });
  it("is valid at the caps, fits the limit, and imports", async () => {
    const doc = maxNetwork();
    expect(superInputsSchema.safeParse(doc).success).toBe(true);
    expect(doc.distanceOverrides).toHaveLength(26_000);
    const bytes = Buffer.byteLength(JSON.stringify(doc));
    console.log(`SM2-3 max-size network: ${bytes} bytes; MAX_IMPORT_BYTES ${MAX_IMPORT_BYTES}`);
    expect(bytes).toBeLessThan(MAX_IMPORT_BYTES);
    const id = await createEmptySuper();
    const res = await imp(id, "replace", doc);
    expect(res.status).toBe(200);
    expect(res.body.scenario.inputs.distanceOverrides).toHaveLength(26_000);
  });
});
```

  A pre-plan estimate of this shape (Python, same counts, random full-precision floats) measured **1,913,859 B** against 2,097,152 — record the number this test prints, not that estimate.

- [ ] **Step 2: Run, expect FAIL** (no `issues`): `DATABASE_URL="postgresql://shubhamkr@localhost:5432/nos_dev" pnpm --filter api-server exec vitest run src/__tests__/superNetworkImport.test.ts src/__tests__/superMaxSize.test.ts`

- [ ] **Step 3: Producers.**

```ts
// formatInputIssues.ts — after formatInputIssues
/** The same issues as data, for callers that must point at a file/row/column (network import, spec §7.1). */
export interface InputIssue { path: (string | number)[]; message: string }
export function toInputIssues(issues: z.ZodIssue[]): InputIssue[] {
  return issues.map(i => ({ path: [...i.path], message: i.message }));
}
```
```ts
// modelRegistry.ts:130-150
export type ValidateInputsResult =
  | { success: true; data: Record<string, unknown> }
  | { success: false; error: string; issues: InputIssue[] };
//   unknown model: return { success: false, error: `Unknown model_id: ${modelId}`, issues: [] };
//   Zod failure:   return { success: false, error: formatInputIssues(result.error.issues), issues: toInputIssues(result.error.issues) };
```
```ts
// scenarioInputWrite.ts
  | { kind: "invalid"; error: string; issues: InputIssue[] };
//   :86  if (!validation.success) return { kind: "invalid", error: validation.error, issues: validation.issues };
```

  Run `pnpm run typecheck`; any other constructor of these types (test mocks included) gets `issues: []`.

- [ ] **Step 4: Origin map** (`services/superNetwork.ts`):

```ts
import type { InputIssue } from "../validation/formatInputIssues.js";

export type MergeOrigin = Partial<Record<Table, (number | null)[]>>;

/** replace: absent keys reset to defaults (merged index == document index, so no origin). merge: upsert by key, never delete;
 *  origin[t][mergedIndex] = the document row that produced it, or null for a kept existing row. */
export function mergeNetwork(current: SuperInputs, doc: SuperNetworkDoc, mode: "replace" | "merge"): { next: Record<string, unknown>; origin: MergeOrigin } {
  if (mode === "replace") return { next: { ...SUPER_DEFAULT_INPUTS, ...doc }, origin: {} };
  const next: Record<string, unknown> = { ...current };
  const origin: MergeOrigin = {};
  for (const [k, v] of Object.entries(doc)) {
    if (!(k in KEY)) { next[k] = v; continue; }
    const t = k as Table, key = KEY[t];
    const rows = new Map((current[t] as Record<string, unknown>[]).map(r => [key(r), { r, src: null as number | null }]));
    (v as Record<string, unknown>[]).forEach((r, i) => rows.set(key(r), { r, src: i }));   // Map.set keeps an existing key's position
    next[t] = [...rows.values()].map(x => x.r);
    origin[t] = [...rows.values()].map(x => x.src);
  }
  return { next, origin };
}

/** Rewrites whole-network issue paths from merged-table rows to imported-document rows (spec §7.1: path[1] is a file row). */
export function toDocIssues(issues: InputIssue[], origin: MergeOrigin): InputIssue[] {
  return issues.map(issue => {
    const [t, i, ...rest] = issue.path;
    const o = typeof t === "string" ? origin[t as Table] : undefined;
    if (!o || typeof i !== "number") return issue;
    const src = o[i];
    return src == null
      ? { path: [t as string], message: `Existing ${t} row ${i + 1}: ${issue.message}` }
      : { path: [t as string, src, ...rest], message: issue.message };
  });
}
```

- [ ] **Step 5: Route** (`routes/superNetwork.ts:41-50`):

```ts
  const doc = superNetworkDocSchema.safeParse(req.body);
  if (!doc.success) { res.status(422).json({ error: formatInputIssues(doc.error.issues), issues: toInputIssues(doc.error.issues) }); return; }
  let origin: MergeOrigin = {};
  const outcome = await db.transaction(async tx => {
    const [cur] = await tx.select().from(scenariosTable)
      .where(and(eq(scenariosTable.id, id), eq(scenariosTable.userId, req.userId!))).for("update");
    if (!cur) return { kind: "not_found" as const };
    const merged = mergeNetwork(superInputsSchema.parse(cur.inputs), doc.data, mode);
    origin = merged.origin;
    return applyScenarioInputWrite(tx, { scenarioId: id, userId: req.userId!, nextInputs: merged.next });
  });
  if (outcome.kind === "not_found") { res.status(404).json({ error: "Not found" }); return; }
  if (outcome.kind === "invalid") { res.status(422).json({ error: outcome.error, issues: toDocIssues(outcome.issues, origin) }); return; }
```

- [ ] **Step 6: OpenAPI.** Under `components.schemas` (next to `ErrorEnvelope`, `:1073`):

```yaml
    NetworkImportIssue:
      type: object
      required: [path, message]
      properties:
        path:
          type: array
          description: "Document-relative: [table or parameter, row index in the imported table, column]."
          items:
            oneOf:
              - type: string
              - type: integer
        message:
          type: string
    NetworkImportRejection:
      type: object
      required: [error, issues]
      properties:
        error:
          type: string
        issues:
          type: array
          items:
            $ref: "#/components/schemas/NetworkImportIssue"
```

  Import path 422 (`:461-466`): `$ref: "#/components/schemas/NetworkImportRejection"`. Run `pnpm --filter @workspace/api-spec run codegen`. If its `typecheck:libs` step reports an ambiguous star export (TS2308), add the colliding name to the explicit `export type { … } from "./generated/types";` list in `lib/api-zod/src/index.ts`, as SM-6 did.

- [ ] **Step 7: Run** the two files (PASS) and record the printed byte count in the changelog entry. **If the byte count is ≥ `MAX_IMPORT_BYTES`**: in `routes/superNetwork.ts` replace `json({ limit: MAX_IMPORT_BYTES })` with `json({ limit: SUPER_NETWORK_MAX_BYTES })`, add `export const SUPER_NETWORK_MAX_BYTES = 4 * 1024 * 1024;` to `validation/inputs/superInputs.ts`, make `app.ts:76-77`'s `scenarioWriteJsonBody` use the same constant (the Studio PATCH carries the same network), update the 413 description in `openapi.yaml:455` and the Studio check in Task 5 to import this constant, and assert `bytes < SUPER_NETWORK_MAX_BYTES` instead. Then `pnpm gate`.

- [ ] **Step 8: Commit** on `sm2-3-work`:
```bash
[ "$(git rev-parse --abbrev-ref HEAD)" != "main" ] || { echo "ON MAIN — commit refused"; exit 1; }
git add artifacts/api-server/src/__tests__/superMaxSize.test.ts lib/api-zod/src/generated lib/api-client-react/src/generated
git commit artifacts/api-server/src/validation/formatInputIssues.ts artifacts/api-server/src/registry/modelRegistry.ts artifacts/api-server/src/services/scenarioInputWrite.ts artifacts/api-server/src/services/superNetwork.ts artifacts/api-server/src/routes/superNetwork.ts artifacts/api-server/src/__tests__/superNetworkImport.test.ts artifacts/api-server/src/__tests__/superMaxSize.test.ts lib/api-spec/openapi.yaml lib/api-zod lib/api-client-react/src/generated docs/CHANGELOG-implementation.md -m "[SM2-3] return document-relative 422 issues from network import and measure the max network"
```

---

### Task 4 [SM2-4]: Browser CSV/XLSX parse and export module (dependency choice)

Role: frontend-engineer.

**Files:**
- Modify: `artifacts/studio/package.json`, `pnpm-lock.yaml`
- Create: `artifacts/studio/src/lib/superFiles.ts`
- Modify: `artifacts/studio/src/lib/clientCsv.ts:17-31` (`downloadBlob`)
- Create: `artifacts/studio/src/__tests__/superFiles.test.ts`

**Interfaces:**
- Produces (`lib/superFiles.ts`):
  ```ts
  export type TableKey = "products" | "plants" | "warehouses" | "customers" | "plantProducts" | "demand" | "distanceOverrides";
  export const SUPER_TABLE_FILES: { key: TableKey; file: string; cols: Col[] }[];
  export const PARAMETER_KEYS: readonly string[];
  export interface Source { source: string; rows: number[] }       // rows[i] = 1-based file row of document row i
  export type Sources = Record<string, Source>;                      // table key, or parameter key ("p", "transportCosts.icMinTrans")
  export interface ParseError { where: string; message: string }
  export type ParseResult = { ok: true; doc: Record<string, unknown>; sources: Sources } | { ok: false; errors: ParseError[] };
  export function parseJsonText(text: string): ParseResult;
  export function parseCsvFiles(files: { name: string; text: string }[]): ParseResult;
  export function parseXlsx(data: ArrayBuffer): Promise<ParseResult>;
  export function toCsvFiles(doc: Record<string, unknown>): { name: string; text: string }[];
  export function toCsvZip(doc: Record<string, unknown>): Promise<Uint8Array>;
  export function toXlsx(doc: Record<string, unknown>): Promise<ArrayBuffer>;
  export function describeIssue(issue: { path: (string | number)[]; message: string }, sources: Sources): string;
  ```
- Produces (`clientCsv.ts`): `export function downloadBlob(filename: string, data: BlobPart, mimeType: string): void` (and `downloadTextFile` delegates to it).
- Consumes: `csvCell`/`csvText` (`clientCsv.ts:5-15`).

- [ ] **Step 1: Choose the XLSX and zip libraries — measure, then record.** Run and paste the output into the changelog entry:

```bash
for p in read-excel-file write-excel-file exceljs fflate jszip papaparse; do echo "== $p"; npm view $p version time.modified dependencies --json; done
curl -sI https://cdn.sheetjs.com/ | head -3
curl -s https://cdn.sheetjs.com/ | grep -o 'xlsx-[0-9.]*\.tgz' | sort -u | tail -3
pnpm audit --json > /tmp/sm2-4-audit-before.json; node -e 'const a=require("/tmp/sm2-4-audit-before.json");console.log(a.metadata?.vulnerabilities)'
```

  Decision rule (apply in order; the code below is written for the first outcome):
  1. **SheetJS from `cdn.sheetjs.com`, version ≥ 0.20.2** — one package reads and writes, exposes cell types `t: "s"|"n"|"b"|"d"|"e"` and formula cached values (`v` with `f`), which §7.2's cell rules need directly. Rejected only if the CDN is unreachable from this machine, or the version on the CDN is < 0.20.2 (the npm `xlsx@0.18.5` is stale and carries the 0.19.3 / 0.20.2 advisories — never install it from the registry). Note in the changelog that `pnpm audit` does not cover tarball-URL dependencies, so its advisories must be read from the SheetJS site.
  2. **exceljs** — rejected for the browser: its runtime deps (`tmp`, `archiver`, `unzipper`, `fast-csv`, `readable-stream`, checked 2026-10-23) are Node-oriented.
  3. **read-excel-file + write-excel-file** — two packages (spec §7.2 says one); only if SheetJS is ruled out, and only after confirming `read-excel-file` reports date/error/formula-without-value cells distinctly. If it is chosen, **stop and report to the lead**: `parseXlsx`/`toXlsx` below are SheetJS-specific and need a re-plan of those two functions only.
  - Zip: **fflate** (0 deps; `zipSync`/`strToU8`) over jszip (4 deps incl. `readable-stream`).

  Install (devDependencies, the studio convention): `pnpm --filter studio add -D https://cdn.sheetjs.com/xlsx-<version>/xlsx-<version>.tgz fflate@<version> papaparse@^5.4.1 @types/papaparse@^5.3.14` (papaparse is already in the lockfile via `lib/import-schema`; the studio needs its own entry under pnpm's strict layout). Re-run the audit command to `/tmp/sm2-4-audit-after.json` and record both `vulnerabilities` objects; any new high/critical ⇒ stop and report.

- [ ] **Step 2: Failing tests** (`src/__tests__/superFiles.test.ts`):

```ts
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import * as XLSX from "xlsx";
import { unzipSync, strFromU8 } from "fflate";
import { describeIssue, parseCsvFiles, parseJsonText, parseXlsx, toCsvFiles, toCsvZip, toXlsx } from "@/lib/superFiles";

const sample = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../../public/samples/super-model-sample.json"), "utf8"));
const ok = <T extends { ok: boolean }>(r: T) => { if (!r.ok) throw new Error(JSON.stringify(r)); return r as Extract<T, { ok: true }>; };
const csv = (files: Record<string, string>) => parseCsvFiles(Object.entries(files).map(([name, text]) => ({ name, text })));
const msgs = (r: { ok: boolean }) => (r.ok ? [] : (r as { errors: { where: string; message: string }[] }).errors.map(e => `${e.where}: ${e.message}`));
const book = (sheets: Record<string, XLSX.WorkSheet>) => {
  const wb = XLSX.utils.book_new();
  for (const [n, ws] of Object.entries(sheets)) XLSX.utils.book_append_sheet(wb, ws, n);
  return XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
};

describe("format parity and round-trip (real writer, not a hand-built fixture)", () => {
  it("the sample exported as CSV files and as XLSX parses back to the identical document", async () => {
    const fromCsv = ok(parseCsvFiles(toCsvFiles(sample))).doc;
    const fromXlsx = ok(await parseXlsx(await toXlsx(sample))).doc;
    const fromJson = ok(parseJsonText(JSON.stringify(sample))).doc;
    expect(fromCsv).toEqual(sample);
    expect(fromXlsx).toEqual(sample);
    expect(fromJson).toEqual(sample);
  });
  it("the CSV zip holds the eight files and re-parses to the same document", async () => {
    const files = unzipSync(await toCsvZip(sample));
    expect(Object.keys(files).sort()).toEqual(["customers.csv", "demand.csv", "distance_overrides.csv", "parameters.csv", "plant_products.csv", "plants.csv", "products.csv", "warehouses.csv"]);
    expect(ok(parseCsvFiles(Object.entries(files).map(([name, u]) => ({ name, text: strFromU8(u) })))).doc).toEqual(sample);
  });
  it("strings starting with = + - @ round-trip through CSV and XLSX", async () => {
    const doc = { products: ["=SUM(A1)", "+1 cmd", "-x", "@me"].map((name, i) => ({ id: `k${i}`, name })) };
    const text = toCsvFiles(doc).find(f => f.name === "products.csv")!.text;
    expect(text).toContain("'=SUM(A1)");                       // guard applied on export
    expect(ok(parseCsvFiles(toCsvFiles(doc))).doc.products).toEqual(doc.products);
    expect(ok(await parseXlsx(await toXlsx(doc))).doc.products).toEqual(doc.products);
  });
});

describe("cell coercion", () => {
  it("numeric-looking ids stay text; numeric columns parse; empty optional omitted; empty rows skipped", () => {
    const r = ok(csv({ "plants.csv": "id,name,city,lat,lng\n101,P,,1.5,-2\n,,,,\n102,Q,Town,3,4\n" }));
    expect(r.doc.plants).toEqual([{ id: "101", name: "P", lat: 1.5, lng: -2 }, { id: "102", name: "Q", city: "Town", lat: 3, lng: 4 }]);
    expect(r.sources.plants.rows).toEqual([2, 4]);
  });
  it("XLSX: numeric id cell -> text, formula uses cached value; date, error and uncached formula are errors", async () => {
    const ws = XLSX.utils.aoa_to_sheet([["id", "name", "lat", "lng"], [101, "P", 1, 2]]);
    ws["C2"] = { t: "n", v: 5, f: "2+3" };
    const good = ok(await parseXlsx(book({ plants: ws })));
    expect(good.doc.plants).toEqual([{ id: "101", name: "P", lat: 5, lng: 2 }]);
    for (const [cell, why] of [[{ t: "d", v: new Date("2026-01-01") }, "date"], [{ t: "e", v: 7 }, "error"], [{ t: "n", f: "1+1" }, "cached"]] as const) {
      const bad = XLSX.utils.aoa_to_sheet([["id", "name", "lat", "lng"], ["x", "P", 1, 2]]);
      bad["C2"] = cell as XLSX.CellObject;
      const r = await parseXlsx(book({ plants: bad }));
      expect(r.ok).toBe(false);
      expect(msgs(r).join("\n")).toMatch(new RegExp(`^sheet plants row 2 column lat: .*${why}`));
    }
  });
  it("names the file, row and column of a bad number, a missing required cell and an unknown column", () => {
    const r = csv({ "plants.csv": "id,name,lat,lng,colour\nA,P,north,2,red\n,Q,1,2,\n" });
    expect(r.ok).toBe(false);
    expect(msgs(r)).toContain("plants.csv column colour: unknown column");
  });
  it("bad number and missing required cell", () => {
    const r = csv({ "plants.csv": "id,name,lat,lng\nA,P,north,2\n,Q,1,2\n" });
    expect(msgs(r)).toEqual(["plants.csv row 2 column lat: is not a number", "plants.csv row 3 column id: is required"]);
  });
  it("rejects unknown files and missing required columns", () => {
    expect(msgs(csv({ "stuff.csv": "a\n1\n" }))).toEqual(["stuff.csv: unknown file name"]);
    expect(msgs(csv({ "demand.csv": "customerId,productId\nc,k\n" }))).toEqual(["demand.csv column demand: required column is missing"]);
  });
});

describe("parameters", () => {
  it("maps keys, nests transportCosts, drops empty values", () => {
    const r = ok(csv({ "parameters.csv": "key,value\np,3\ndistanceMethod,circuity\ngap,\ntransportCosts.icTransCost,0.1\n" }));
    expect(r.doc).toEqual({ p: 3, distanceMethod: "circuity", transportCosts: { icTransCost: 0.1 } });
    expect(r.sources["transportCosts.icTransCost"].rows).toEqual([5]);
  });
  it("unknown and duplicate keys are errors", () => {
    expect(msgs(csv({ "parameters.csv": "key,value\nfoo,1\n" }))).toEqual(["parameters.csv row 2: unknown parameter foo"]);
    expect(msgs(csv({ "parameters.csv": "key,value\np,1\np,2\n" }))).toEqual(["parameters.csv row 3: duplicate parameter p"]);
  });
});

describe("422 issue -> file/row/column", () => {
  it("uses the row map, the column and the parameter row", () => {
    const { sources } = ok(csv({ "plants.csv": "id,name,lat,lng\nA,P,1,2\n,,,\nB,Q,3,4\n", "parameters.csv": "key,value\np,0\n" }));
    expect(describeIssue({ path: ["plants", 1, "lat"], message: "too big" }, sources)).toBe("plants.csv row 4 column lat: too big");
    expect(describeIssue({ path: ["p"], message: "must be ≥ 1" }, sources)).toBe("parameters.csv row 2: must be ≥ 1");
    expect(describeIssue({ path: ["demand"], message: "Existing demand row 3: x" }, sources)).toBe("demand: Existing demand row 3: x");
  });
});
```

- [ ] **Step 3: Run, expect FAIL** (module missing): `pnpm --filter studio exec vitest run src/__tests__/superFiles.test.ts`

- [ ] **Step 4: Implement `lib/superFiles.ts`:**

```ts
// SM2-4 (spec §7, D6) — CSV / XLSX <-> the §3.2 network document, entirely in the browser.
// The server stays the only validator: this module only reads cells into typed values.
import Papa from "papaparse";
import type { CellObject } from "xlsx";
import { csvText } from "@/lib/clientCsv";

export type TableKey = "products" | "plants" | "warehouses" | "customers" | "plantProducts" | "demand" | "distanceOverrides";
interface Col { field: string; type: "text" | "number"; required: boolean }
const c = (field: string, type: Col["type"], required = true): Col => ({ field, type, required });
const LOC = [c("id", "text"), c("name", "text"), c("city", "text", false), c("state", "text", false), c("lat", "number"), c("lng", "number")];
export const SUPER_TABLE_FILES: { key: TableKey; file: string; cols: Col[] }[] = [
  { key: "products", file: "products", cols: [c("id", "text"), c("name", "text")] },
  { key: "plants", file: "plants", cols: LOC },
  { key: "warehouses", file: "warehouses", cols: [...LOC, c("status", "text", false)] },
  { key: "customers", file: "customers", cols: [...LOC, c("status", "text", false)] },
  { key: "plantProducts", file: "plant_products", cols: [c("plantId", "text"), c("productId", "text"), c("capacity", "number"), c("costPerUnit", "number")] },
  { key: "demand", file: "demand", cols: [c("customerId", "text"), c("productId", "text"), c("demand", "number")] },
  { key: "distanceOverrides", file: "distance_overrides", cols: [c("fromId", "text"), c("toId", "text"), c("miles", "number")] },
];
export const PARAMETER_KEYS = ["p", "gap", "timeLimitSec", "distanceMethod", "circuityFactor",
  "transportCosts.icTransCost", "transportCosts.icMinTrans", "transportCosts.obTransCost", "transportCosts.obMinTrans"] as const;
const PARAMS = "parameters";

export interface Source { source: string; rows: number[] }
export type Sources = Record<string, Source>;
export interface ParseError { where: string; message: string }
export type ParseResult = { ok: true; doc: Record<string, unknown>; sources: Sources } | { ok: false; errors: ParseError[] };

type Cell = { kind: "text"; v: string } | { kind: "number"; v: number } | { kind: "empty" } | { kind: "bad"; why: string };
interface Sheet { name: string; source: string; csv: boolean; firstRow: number; rows: Cell[][] }
const EMPTY: Cell = { kind: "empty" };
const NUMBER = /^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i;
const GUARDED = /^'[=+\-@\t\r]/;                       // reverses clientCsv.ts csvCell's prefix

function asText(cell: Cell, csv: boolean): string | null | { error: string } {
  if (cell.kind === "bad") return { error: cell.why };
  if (cell.kind === "number") return String(cell.v);
  if (cell.kind === "empty") return null;
  const t = cell.v.trim();
  if (t === "") return null;
  return csv && GUARDED.test(t) ? t.slice(1) : t;
}
function asNumber(cell: Cell): number | null | { error: string } {
  if (cell.kind === "bad") return { error: cell.why };
  if (cell.kind === "number") return Number.isFinite(cell.v) ? cell.v : { error: "is not a finite number" };
  if (cell.kind === "empty" || cell.v.trim() === "") return null;
  return NUMBER.test(cell.v.trim()) ? Number(cell.v.trim()) : { error: "is not a number" };
}
const isBlank = (row: Cell[]) => row.every(x => x.kind === "empty" || (x.kind === "text" && x.v.trim() === ""));

function readSheet(sh: Sheet, cols: Col[], errors: ParseError[]): { rows: Record<string, unknown>[]; fileRows: number[] } {
  const header = (sh.rows[0] ?? []).map(h => asText(h, false));
  const at = new Map<string, number>();
  header.forEach((h, i) => {
    if (h === null || typeof h === "object") return;
    if (!cols.some(col => col.field === h)) errors.push({ where: `${sh.source} column ${h}`, message: "unknown column" });
    else if (at.has(h)) errors.push({ where: `${sh.source} column ${h}`, message: "duplicate column" });
    else at.set(h, i);
  });
  for (const col of cols) if (col.required && !at.has(col.field)) errors.push({ where: `${sh.source} column ${col.field}`, message: "required column is missing" });
  const rows: Record<string, unknown>[] = [], fileRows: number[] = [];
  sh.rows.slice(1).forEach((row, i) => {
    if (isBlank(row)) return;
    const rowNo = sh.firstRow + i + 1;
    const out: Record<string, unknown> = {};
    for (const col of cols) {
      const idx = at.get(col.field);
      if (idx === undefined) continue;
      const cell = row[idx] ?? EMPTY;
      const v = col.type === "number" ? asNumber(cell) : asText(cell, sh.csv);
      const where = `${sh.source} row ${rowNo} column ${col.field}`;
      if (v !== null && typeof v === "object") errors.push({ where, message: v.error });
      else if (v === null) { if (col.required) errors.push({ where, message: "is required" }); }
      else out[col.field] = v;
    }
    rows.push(out); fileRows.push(rowNo);
  });
  return { rows, fileRows };
}

function readParameters(sh: Sheet, doc: Record<string, unknown>, sources: Sources, errors: ParseError[]): void {
  const { rows, fileRows } = readSheet(sh, [c("key", "text"), c("value", "text", false)], errors);
  const seen = new Set<string>();
  rows.forEach((r, i) => {
    const key = String(r.key), where = `${sh.source} row ${fileRows[i]}`;
    if (!(PARAMETER_KEYS as readonly string[]).includes(key)) return void errors.push({ where, message: `unknown parameter ${key}` });
    if (seen.has(key)) return void errors.push({ where, message: `duplicate parameter ${key}` });
    seen.add(key);
    if (r.value === undefined) return;                                   // empty value = absent (§7.2)
    let value: unknown = r.value;
    if (key !== "distanceMethod") {
      const n = asNumber({ kind: "text", v: String(r.value) });
      if (n === null || typeof n === "object") return void errors.push({ where: `${where} column value`, message: "is not a number" });
      value = n;
    }
    const [head, sub] = key.split(".");
    if (sub) doc[head] = { ...(doc[head] as Record<string, unknown> | undefined), [sub]: value };
    else doc[head] = value;
    sources[key] = { source: sh.source, rows: [fileRows[i]] };
  });
}

function sheetsToDocument(sheets: Sheet[]): ParseResult {
  const errors: ParseError[] = [], doc: Record<string, unknown> = {}, sources: Sources = {};
  for (const sh of sheets) {
    if (sh.name === PARAMS) { readParameters(sh, doc, sources, errors); continue; }
    const t = SUPER_TABLE_FILES.find(x => x.file === sh.name);
    if (!t) { errors.push({ where: sh.source, message: sh.csv ? "unknown file name" : "unknown sheet name" }); continue; }
    const { rows, fileRows } = readSheet(sh, t.cols, errors);
    doc[t.key] = rows;
    sources[t.key] = { source: sh.source, rows: fileRows };
  }
  return errors.length ? { ok: false, errors } : { ok: true, doc, sources };
}

export function parseJsonText(text: string): ParseResult {
  try {
    const v: unknown = JSON.parse(text);
    if (v !== null && typeof v === "object" && !Array.isArray(v)) return { ok: true, doc: v as Record<string, unknown>, sources: {} };
  } catch { /* fall through */ }
  return { ok: false, errors: [{ where: "file", message: "is not a valid network document (a JSON object)" }] };
}

export function parseCsvFiles(files: { name: string; text: string }[]): ParseResult {
  const sheets: Sheet[] = [], errors: ParseError[] = [];
  for (const f of files) {
    const stem = f.name.endsWith(".csv") ? f.name.slice(0, -4) : f.name;
    if (stem === f.name) { errors.push({ where: f.name, message: "unknown file name" }); continue; }
    const parsed = Papa.parse<string[]>(f.text, { skipEmptyLines: false });
    for (const e of parsed.errors) errors.push({ where: `${f.name} row ${(e.row ?? 0) + 1}`, message: e.message });
    sheets.push({ name: stem, source: f.name, csv: true, firstRow: 1,
      rows: parsed.data.map(r => r.map((v): Cell => (v === "" ? EMPTY : { kind: "text", v }))) });
  }
  if (errors.length) return { ok: false, errors };
  return sheetsToDocument(sheets);
}

function xlsxCell(cell: CellObject | undefined): Cell {
  if (!cell || cell.t === "z") return EMPTY;
  if (cell.f !== undefined && cell.v === undefined) return { kind: "bad", why: "is a formula with no cached value" };
  if (cell.t === "n") return { kind: "number", v: cell.v as number };
  if (cell.t === "s") return cell.v === "" ? EMPTY : { kind: "text", v: String(cell.v) };
  if (cell.t === "b") return { kind: "text", v: String(cell.v) };
  if (cell.t === "d") return { kind: "bad", why: "is a date cell" };
  return { kind: "bad", why: "is an error cell" };
}

export async function parseXlsx(data: ArrayBuffer): Promise<ParseResult> {
  const XLSX = await import("xlsx");
  let wb: ReturnType<typeof XLSX.read>;
  try { wb = XLSX.read(data, { type: "array", cellDates: true }); }
  catch { return { ok: false, errors: [{ where: "workbook", message: "is not a readable .xlsx file" }] }; }
  return sheetsToDocument(wb.SheetNames.map(name => {
    const ws = wb.Sheets[name], ref = ws["!ref"];
    const sheet: Sheet = { name, source: `sheet ${name}`, csv: false, firstRow: 1, rows: [] };
    if (!ref) return sheet;
    const r = XLSX.utils.decode_range(ref);
    sheet.firstRow = r.s.r + 1;
    for (let y = r.s.r; y <= r.e.r; y++) {
      const row: Cell[] = [];
      for (let x = r.s.c; x <= r.e.c; x++) row.push(xlsxCell(ws[XLSX.utils.encode_cell({ r: y, c: x })] as CellObject | undefined));
      sheet.rows.push(row);
    }
    return sheet;
  }));
}

/** Header + rows per table (every table, header-only when empty) + a key,value parameters sheet. */
function documentToSheets(doc: Record<string, unknown>): { name: string; rows: (string | number)[][] }[] {
  const out = SUPER_TABLE_FILES.map(t => ({
    name: t.file,
    rows: [t.cols.map(col => col.field),
      ...((doc[t.key] as Record<string, unknown>[] | undefined) ?? []).map(r => t.cols.map(col => (r[col.field] ?? "") as string | number))],
  }));
  const params: (string | number)[][] = [["key", "value"]];
  for (const key of PARAMETER_KEYS) {
    const [head, sub] = key.split(".");
    const v = sub ? (doc[head] as Record<string, unknown> | undefined)?.[sub] : doc[head];
    if (v !== undefined) params.push([key, v as string | number]);
  }
  return [...out, { name: PARAMS, rows: params }];
}

export function toCsvFiles(doc: Record<string, unknown>): { name: string; text: string }[] {
  return documentToSheets(doc).map(s => ({ name: `${s.name}.csv`, text: `${csvText(s.rows)}\n` }));
}
export async function toCsvZip(doc: Record<string, unknown>): Promise<Uint8Array> {
  const { zipSync, strToU8 } = await import("fflate");
  return zipSync(Object.fromEntries(toCsvFiles(doc).map(f => [f.name, strToU8(f.text)])));
}
export async function toXlsx(doc: Record<string, unknown>): Promise<ArrayBuffer> {
  const XLSX = await import("xlsx");
  const wb = XLSX.utils.book_new();
  // aoa_to_sheet writes strings as "s" cells and numbers as "n" cells, never formulas (spec §7.2).
  for (const s of documentToSheets(doc)) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(s.rows), s.name);
  return XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
}

/** §7.1: path[0] -> file/sheet, path[1] -> file row (row map; path[1] + 2 when no row was skipped), path[2] -> column. */
export function describeIssue(issue: { path: (string | number)[]; message: string }, sources: Sources): string {
  const [head, second, third] = issue.path;
  const param = typeof second === "string" ? sources[`${head}.${second}`] : undefined;
  const src = param ?? sources[String(head)];
  if (!src) return `${issue.path.join(".")}: ${issue.message}`;
  if (param || (PARAMETER_KEYS as readonly string[]).includes(String(head))) return `${src.source} row ${src.rows[0]}: ${issue.message}`;
  const row = typeof second === "number" ? ` row ${src.rows[second] ?? second + 2}` : "";
  const col = typeof third === "string" ? ` column ${third}` : "";
  return `${src.source}${row}${col}: ${issue.message}`;
}
```

  Parameter rows are read as text then coerced, so an XLSX numeric value cell (`kind: "number"`) reaches `readParameters` as its `String(v)` (via `asText`) and is re-parsed — finite numbers survive exactly (`String`/`Number` round-trip). The XLSX formula test's expectation `"sheet plants row 2 column lat"` matches `readSheet`'s `where` for `firstRow = 1`.

  `clientCsv.ts`:
```ts
export function downloadBlob(filename: string, data: BlobPart, mimeType: string): void {
  const url = URL.createObjectURL(new Blob([data], { type: mimeType }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
export function downloadTextFile(filename: string, text: string, mimeType: string): void {
  downloadBlob(filename, text, mimeType);
}
```

- [ ] **Step 5: Run** `superFiles.test.ts` (PASS). Non-vacuity: temporarily drop the `GUARDED` strip and confirm the formula round-trip test fails; restore. Then `pnpm --filter studio run build` (confirms the dynamic imports split into their own chunks — record the chunk sizes) and `pnpm gate`.

- [ ] **Step 6: Commit** on `sm2-4-work`:
```bash
[ "$(git rev-parse --abbrev-ref HEAD)" != "main" ] || { echo "ON MAIN — commit refused"; exit 1; }
git add artifacts/studio/src/lib/superFiles.ts artifacts/studio/src/__tests__/superFiles.test.ts
git commit artifacts/studio/package.json pnpm-lock.yaml artifacts/studio/src/lib/superFiles.ts artifacts/studio/src/lib/clientCsv.ts artifacts/studio/src/__tests__/superFiles.test.ts docs/CHANGELOG-implementation.md -m "[SM2-4] parse and build super-model CSV and XLSX networks in the browser"
```

---
### Task 5 [SM2-5]: Import dialog for CSV / XLSX / JSON, CSV-zip and XLSX export, CSV/XLSX templates and sample

Role: frontend-engineer.

**Files:**
- Modify: `artifacts/studio/src/components/workspace/super/SuperNetworkImportDialog.tsx` (whole file, 119 lines)
- Modify: `artifacts/studio/src/components/workspace/super/SuperReadinessPanel.tsx:11-22`
- Modify: `artifacts/studio/src/lib/superNetwork.ts:26-27` (`downloadSuperFile`)
- Modify: `artifacts/studio/src/pages/Workspace.tsx:2771-2778` (`handleSuperExport` takes a format), `:4501-4508` (three export buttons)
- Modify: `artifacts/studio/src/__tests__/SuperNetworkImportDialog.test.tsx`, `artifacts/studio/src/__tests__/SuperReadinessPanel.test.tsx`, `artifacts/studio/src/__tests__/Workspace.Super.test.tsx`

**Interfaces:**
- Consumes: Task 4's `parseJsonText`, `parseCsvFiles`, `parseXlsx`, `toCsvZip`, `toXlsx`, `describeIssue`, `Sources`, `downloadBlob`; Task 3's 422 `issues`.
- Produces (`lib/superNetwork.ts`): `export type SuperFileFormat = "json" | "csv" | "xlsx"; export async function downloadSuperFile(base: string, format: SuperFileFormat, doc: Record<string, unknown>): Promise<void>` — `json` → `downloadAs`, `csv` → `<base>.zip` (`application/zip`), `xlsx` → `<base>.xlsx` (`application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`).
- Test ids added: `super-import-issues` (list), `super-header-export-csv`, `super-header-export-xlsx`, `super-download-template-csv`, `super-download-template-xlsx`, `super-download-sample-csv`, `super-download-sample-xlsx`. Kept: `super-import-file`, `super-import-file-error`, `super-import-error`, `super-header-export` (JSON), `super-download-template`, `super-download-sample` (JSON hrefs).

- [ ] **Step 1: Failing tests** (append to `SuperNetworkImportDialog.test.tsx`, reusing its render/mocks; the mocked `useImportScenarioNetwork` exposes `mutate` as a `vi.fn()`):

```tsx
import { toCsvFiles, toXlsx } from "@/lib/superFiles";
const csvFile = (name: string, text: string) => new File([text], name, { type: "text/csv" });

  it("SM2-5: a CSV set is parsed in the browser and posted as one JSON document", async () => {
    const doc = { products: [{ id: "k", name: "K" }], p: 2 };
    const files = toCsvFiles(doc).map(f => csvFile(f.name, f.text));
    renderDialog({ isEmpty: true });
    fireEvent.change(screen.getByTestId("super-import-file"), { target: { files } });
    await waitFor(() => expect(screen.getByTestId("super-import-confirm")).not.toBeDisabled());
    fireEvent.click(screen.getByTestId("super-import-confirm"));
    expect(mutate.mock.calls[0][0]).toMatchObject({ data: { products: [{ id: "k", name: "K" }], p: 2 }, params: { mode: "replace" } });
  });
  it("SM2-5: an XLSX workbook is parsed and posted", async () => {
    const buf = await toXlsx({ products: [{ id: "k", name: "K" }] });
    renderDialog({ isEmpty: true });
    fireEvent.change(screen.getByTestId("super-import-file"), { target: { files: [new File([buf], "net.xlsx")] } });
    await waitFor(() => expect(screen.getByTestId("super-import-confirm")).not.toBeDisabled());
    fireEvent.click(screen.getByTestId("super-import-confirm"));
    expect(mutate.mock.calls[0][0].data.products).toEqual([{ id: "k", name: "K" }]);
  });
  it("SM2-5: mixed kinds and parse errors are shown and nothing is posted", async () => {
    renderDialog({ isEmpty: true });
    fireEvent.change(screen.getByTestId("super-import-file"), { target: { files: [csvFile("products.csv", "id,name\nk,K\n"), new File(["{}"], "n.json")] } });
    await waitFor(() => expect(screen.getByTestId("super-import-file-error")).toHaveTextContent("one .json file, one .xlsx workbook, or a set of .csv files"));
    fireEvent.change(screen.getByTestId("super-import-file"), { target: { files: [csvFile("plants.csv", "id,name,lat,lng\nA,P,north,2\n")] } });
    await waitFor(() => expect(screen.getByTestId("super-import-file-error")).toHaveTextContent("plants.csv row 2 column lat: is not a number"));
    expect(screen.getByTestId("super-import-confirm")).toBeDisabled();
    expect(mutate).not.toHaveBeenCalled();
  });
  it("SM2-5: a server 422 with issues is shown as file / row / column for a CSV import", async () => {
    mutate.mockImplementation(() => {});
    importState.isError = true;
    importState.error = { status: 422, data: { error: "Demand row 1 …", issues: [{ path: ["demand", 0, "customerId"], message: 'Unknown customer "ghost"' }] } };
    renderDialog({ isEmpty: true });
    fireEvent.change(screen.getByTestId("super-import-file"), { target: { files: [csvFile("demand.csv", "customerId,productId,demand\nghost,k,1\n")] } });
    await waitFor(() => expect(screen.getByTestId("super-import-issues")).toHaveTextContent('demand.csv row 2 column customerId: Unknown customer "ghost"'));
  });
  it("SM2-5: a JSON import with a 422 keeps showing the error string", async () => {
    importState.isError = true;
    importState.error = { status: 422, data: { error: "Demand row 1 customer id is unknown.", issues: [{ path: ["demand", 0], message: "x" }] } };
    renderDialog({ isEmpty: true });
    fireEvent.change(screen.getByTestId("super-import-file"), { target: { files: [new File(['{"demand":[]}'], "n.json")] } });
    await waitFor(() => expect(screen.getByTestId("super-import-error")).toHaveTextContent("Demand row 1 customer id is unknown."));
    expect(screen.queryByTestId("super-import-issues")).not.toBeInTheDocument();
  });
```

  If the existing test file's mock does not already expose a mutable `importState` (`{ isError, error }`) and a shared `mutate`, restructure its `vi.mock("@workspace/api-client-react", …)` to a hoisted object (`const { mutate, importState } = vi.hoisted(() => ({ mutate: vi.fn(), importState: { isError: false, error: null as unknown } }))`, returned as `{ mutate, reset: vi.fn(), isPending: false, ...importState }` from the hook, reset in `beforeEach`). The FileReader-based reading is async, hence the `waitFor`s.

  `SuperReadinessPanel.test.tsx`:

```tsx
  it("SM2-5: offers the template and sample as JSON, CSV zip and XLSX", () => {
    render(<SuperReadinessPanel isEmpty onImport={vi.fn()} />);
    for (const id of ["super-download-template", "super-download-sample", "super-download-template-csv", "super-download-template-xlsx", "super-download-sample-csv", "super-download-sample-xlsx"])
      expect(screen.getByTestId(id)).toBeInTheDocument();
  });
  it("SM2-5: the CSV sample download builds a zip from the JSON sample", async () => {
    const sampleDoc = { products: [{ id: "k", name: "K" }] };
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(sampleDoc))));
    render(<SuperReadinessPanel isEmpty onImport={vi.fn()} />);
    fireEvent.click(screen.getByTestId("super-download-sample-csv"));
    await waitFor(() => expect(vi.mocked(downloadBlob)).toHaveBeenCalledWith("super-model-sample.zip", expect.any(Uint8Array), "application/zip"));
    vi.unstubAllGlobals();
  });
```

  At the top of `SuperReadinessPanel.test.tsx`: `vi.mock("@/lib/clientCsv", async orig => ({ ...(await orig<typeof import("@/lib/clientCsv")>()), downloadBlob: vi.fn() }));` and `import { downloadBlob } from "@/lib/clientCsv";`.

  `Workspace.Super.test.tsx`: `super-header-export-csv` and `super-header-export-xlsx` render next to `super-header-export`.

- [ ] **Step 2: Run, expect FAIL:** `pnpm --filter studio exec vitest run src/__tests__/SuperNetworkImportDialog.test.tsx src/__tests__/SuperReadinessPanel.test.tsx src/__tests__/Workspace.Super.test.tsx`

- [ ] **Step 3: `downloadSuperFile`** (`lib/superNetwork.ts`):

```ts
import { downloadAs, downloadBlob } from "@/lib/clientCsv";
import { toCsvZip, toXlsx } from "@/lib/superFiles";

export type SuperFileFormat = "json" | "csv" | "xlsx";
const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
export async function downloadSuperFile(base: string, format: SuperFileFormat, doc: Record<string, unknown>): Promise<void> {
  if (format === "json") return downloadAs(base, "json", doc);
  if (format === "csv") return downloadBlob(`${base}.zip`, await toCsvZip(doc), "application/zip");
  return downloadBlob(`${base}.xlsx`, await toXlsx(doc), XLSX_MIME);
}
```

- [ ] **Step 4: Readiness panel** (`SuperReadinessPanel.tsx:16-19`) — keep the two JSON `<a download>` links and add:

```tsx
import { downloadSuperFile, SUPER_SAMPLE_URL, SUPER_TEMPLATE_URL } from "@/lib/superNetwork";

const fromJson = (url: string, base: string, format: "csv" | "xlsx") => async () =>
  downloadSuperFile(base, format, await (await fetch(url)).json());
// …
<div className="flex flex-wrap gap-4 text-xs">
  <a className="underline" href={SUPER_TEMPLATE_URL} download data-testid="super-download-template">Template (JSON)</a>
  <button className="underline" onClick={fromJson(SUPER_TEMPLATE_URL, "super-model-template", "csv")} data-testid="super-download-template-csv">Template (CSV zip)</button>
  <button className="underline" onClick={fromJson(SUPER_TEMPLATE_URL, "super-model-template", "xlsx")} data-testid="super-download-template-xlsx">Template (XLSX)</button>
  <a className="underline" href={SUPER_SAMPLE_URL} download data-testid="super-download-sample">Sample (JSON)</a>
  <button className="underline" onClick={fromJson(SUPER_SAMPLE_URL, "super-model-sample", "csv")} data-testid="super-download-sample-csv">Sample (CSV zip)</button>
  <button className="underline" onClick={fromJson(SUPER_SAMPLE_URL, "super-model-sample", "xlsx")} data-testid="super-download-sample-xlsx">Sample (XLSX)</button>
</div>
```

  The CSV/XLSX template and sample are generated from the shipped JSON files by the same exporter (no committed binaries; parity with JSON by construction — open issue 12). The blank template's tables export as header-only files.

- [ ] **Step 5: Dialog** — replace `handleFile`/`doc` state (`SuperNetworkImportDialog.tsx:23-63`) and the error block (`:104-108`):

```tsx
import { MAX_IMPORT_BYTES } from "@workspace/import-schema";
import { describeIssue, parseCsvFiles, parseJsonText, parseXlsx, type ParseResult, type Sources } from "@/lib/superFiles";

const readAs = (file: File, how: "text" | "buffer") => new Promise<string | ArrayBuffer>((resolve, reject) => {
  const r = new FileReader();                                   // FileReader: jsdom's File has no .text()
  r.onload = () => resolve(r.result as string | ArrayBuffer);
  r.onerror = () => reject(r.error);
  if (how === "text") r.readAsText(file); else r.readAsArrayBuffer(file);
});
type Kind = "json" | "csv" | "xlsx";
function kindOf(files: File[]): Kind | null {
  const ext = (f: File) => f.name.toLowerCase().split(".").pop();
  if (files.length > 0 && files.every(f => ext(f) === "csv")) return "csv";
  if (files.length === 1 && ext(files[0]) === "xlsx") return "xlsx";
  if (files.length === 1 && ext(files[0]) === "json") return "json";
  return null;
}
function issuesOf(err: unknown): { path: (string | number)[]; message: string }[] {
  const issues = (err as { data?: { issues?: unknown } } | null)?.data?.issues;
  return Array.isArray(issues) ? issues : [];
}

// state:
  const [parsed, setParsed] = useState<{ doc: Record<string, unknown>; kind: Kind; sources: Sources } | null>(null);
  const [fileErrors, setFileErrors] = useState<string[]>([]);

  async function handleFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (files.length === 0) return;
    importMutation.reset(); setParsed(null); setConfirmingOverwrite(false); setFileErrors([]);
    const kind = kindOf(files);
    if (!kind) return setFileErrors(["Choose one .json file, one .xlsx workbook, or a set of .csv files."]);
    let result: ParseResult;
    if (kind === "json") result = parseJsonText(String(await readAs(files[0], "text")));
    else if (kind === "xlsx") result = await parseXlsx((await readAs(files[0], "buffer")) as ArrayBuffer);
    else result = parseCsvFiles(await Promise.all(files.map(async f => ({ name: f.name, text: String(await readAs(f, "text")) }))));
    if (!result.ok) return setFileErrors(result.errors.map(x => `${x.where}: ${x.message}`));
    // §7.2 Limits: the serialized JSON request is what the body limit measures, for every format.
    if (new Blob([JSON.stringify(result.doc)]).size > MAX_IMPORT_BYTES) return setFileErrors([LIMIT_MESSAGE]);
    setParsed({ doc: result.doc, kind, sources: result.sources });
  }
```

  `handleConfirm` posts `parsed.doc` (was `doc`); `handleOpenChange(false)` also clears `parsed`/`fileErrors`. The input becomes `<input type="file" multiple accept=".json,.xlsx,.csv,application/json,text/csv" data-testid="super-import-file" onChange={handleFiles} />`. Errors:

```tsx
          {fileErrors.length > 0 && (
            <ul className="text-xs text-destructive max-h-40 overflow-auto" data-testid="super-import-file-error">
              {fileErrors.map((m, i) => <li key={i}>{m}</li>)}
            </ul>
          )}
          {importMutation.isError && parsed && parsed.kind !== "json" && issuesOf(importMutation.error).length > 0 ? (
            <ul className="text-xs text-destructive max-h-40 overflow-auto" data-testid="super-import-issues">
              {issuesOf(importMutation.error).map((i, k) => <li key={k}>{describeIssue(i, parsed.sources)}</li>)}
            </ul>
          ) : importMutation.isError && (
            <p className="text-xs text-destructive" data-testid="super-import-error">{describeImportError(importMutation.error, "Import failed.")}</p>
          )}
```

  The confirm button's `disabled` becomes `!parsed || importMutation.isPending`. The old single-file `fileError` state and its existing tests' testid (`super-import-file-error`) stay valid (now a list).

- [ ] **Step 6: Export menu** (`Workspace.tsx`):

```tsx
  async function handleSuperExport(format: SuperFileFormat) {
    if (!currentScenario) return;
    try {
      await downloadSuperFile(`super-model-network-${currentScenario.id}`, format, await exportScenarioNetwork(currentScenario.id, { format: "json" }));
    } catch (err) {
      toast({ title: "Export failed", description: describeWriteError(err, "Could not export the network."), variant: "destructive" });
    }
  }
```
```tsx
                <Button size="sm" variant="outline" onClick={() => handleSuperExport("json")} data-testid="super-header-export">Export JSON</Button>
                <Button size="sm" variant="outline" onClick={() => handleSuperExport("csv")} data-testid="super-header-export-csv">Export CSV</Button>
                <Button size="sm" variant="outline" onClick={() => handleSuperExport("xlsx")} data-testid="super-header-export-xlsx">Export XLSX</Button>
```

  Grep `e2e/` for the old visible text `Export network (JSON)` before committing: `grep -rn "Export network" artifacts/studio/e2e` — rewrite any hit to the testid.

- [ ] **Step 7: Run** the three files (PASS) and `pnpm gate`.

- [ ] **Step 8: Commit** on `sm2-5-work`:
```bash
[ "$(git rev-parse --abbrev-ref HEAD)" != "main" ] || { echo "ON MAIN — commit refused"; exit 1; }
git commit artifacts/studio/src/components/workspace/super/SuperNetworkImportDialog.tsx artifacts/studio/src/components/workspace/super/SuperReadinessPanel.tsx artifacts/studio/src/lib/superNetwork.ts artifacts/studio/src/pages/Workspace.tsx artifacts/studio/src/__tests__/SuperNetworkImportDialog.test.tsx artifacts/studio/src/__tests__/SuperReadinessPanel.test.tsx artifacts/studio/src/__tests__/Workspace.Super.test.tsx docs/CHANGELOG-implementation.md -m "[SM2-5] import and export super-model networks as CSV, XLSX and JSON"
```

---

### Task 6 [SM2-6]: Phase-3 preflight — Render request timeout, ORS API shape, `ORS_API_KEY`

Role: devops-engineer. Documentation + `render.yaml` only; no application code. **This task is a gate: if Render's HTTP request timeout for a web service is ≤ 120 s, or the ORS matrix shape differs from Global Constraints, STOP and report to the lead with the evidence — do not redesign (no job queue, no polling) and do not start Task 7.**

**Files:**
- Modify: `render.yaml:30-63` (`nos-api` `envVars`)
- Modify: `docs/CHANGELOG-implementation.md`
- Modify: this plan's Task 6 "Findings" block below

- [ ] **Step 1: Render timeout.** Invoke the `render-ops` skill (`.claude/skills/render-ops/SKILL.md`; it records no request-timeout fact as of 2026-10-23), then fetch Render's docs (WebFetch): start at `https://render.com/docs/web-services`, then the platform-limits / networking pages it links to (direct guesses `https://render.com/docs/platform-limits` and `https://render.com/docs/connection-timeouts` returned 404 on 2026-10-23). Record the exact quoted sentence and URL. Pass condition: the documented maximum HTTP request duration for a web service is **> 120 s** (the route's deadline plus the transaction).
- [ ] **Step 2: ORS shape.** Fetch the current ORS reference (`https://giscience.github.io/openrouteservice/api-reference/endpoints/matrix/` gives body fields but not limits or the `distances` shape; the API playground `https://openrouteservice.org/dev/#/api-docs/matrix_service` and `https://openrouteservice.org/plans/` give the hosted limits). Check and record, item by item: path `/v2/matrix/driving-hgv`; `Authorization` header carries the key; `locations` are `[lng, lat]`; `sources`/`destinations` are integer index arrays; `metrics: ["distance"]`; `units: "mi"`; response `distances[s][d]`; `null` for unroutable; ≤ 3,500 pairs per request; free plan 500 requests/day and 40/minute for matrix. Any mismatch ⇒ STOP (see above).
- [ ] **Step 3: `render.yaml`** — under `nos-api` `envVars`, after `SENTRY_DSN`:
```yaml
      # SM2-6 — OpenRouteService key for POST /scenarios/:id/network/road-distances
      # (spec §8). Secret: Dashboard-managed, never in this file. Unset => the
      # route returns 503 road_distances_unavailable. Adding it is a deploy-checklist item.
      - key: ORS_API_KEY
        sync: false
```
  Validate: `render blueprints validate render.yaml` if the Render CLI is installed (`render-cli` skill); otherwise record "not validated (no CLI)".
- [ ] **Step 4: Findings** — replace the block below with the measured facts (quotes + URLs + date), and append a changelog entry with the same.

  > **Findings (to be filled by Task 6):** Render timeout — not yet verified. ORS shape — not yet verified.

- [ ] **Step 5: Commit** on `sm2-6-work`:
```bash
[ "$(git rev-parse --abbrev-ref HEAD)" != "main" ] || { echo "ON MAIN — commit refused"; exit 1; }
git commit render.yaml docs/CHANGELOG-implementation.md docs/superpowers/plans/2026-10-23-super-model-phase2-3.md -m "[SM2-6] record road-distance preflight checks and declare ORS_API_KEY"
```

---

### Task 7 [SM2-7]: Road contract — `road` method, persisted `roadDistances`, server-written only

Role: backend-engineer.

**Files:**
- Modify: `artifacts/api-server/src/validation/inputs/superInputs.ts:26-43`
- Modify: `solvers/super-model/manifest.json` (`inputsSchema.properties.distanceMethod.enum`, new `roadDistances` property)
- Modify: `artifacts/api-server/src/validation/formatInputIssues.ts:59-67` (`roadDistances: "Road distances"`)
- Modify: `artifacts/api-server/src/services/scenarioInputWrite.ts:40-44, 75-91`
- Modify: `artifacts/api-server/src/routes/scenarios.ts:214` (POST create)
- Modify: `artifacts/api-server/src/routes/superNetwork.ts` (import passes keep/clear; export strips)
- Modify: `artifacts/api-server/src/__tests__/superModelRegistration.test.ts:55-67`
- Create: `artifacts/api-server/src/__tests__/superRoadContract.test.ts`

**Interfaces:**
- Produces (`superInputs.ts`):
  ```ts
  export const roadDistancesSchema: z.ZodObject<…>;   // { fetchedAt: ISO string, profile: "driving-hgv", coords: Record<id, [lat, lng]>, pairs: { fromId, toId, miles ≥ 0 }[] }
  export type RoadDistances = z.infer<typeof roadDistancesSchema>;
  superParamSchemas.distanceMethod = z.enum(["haversine", "circuity", "road"]);
  superInputsSchema gains roadDistances: roadDistancesSchema.optional();   // the network document schema (superNetworkDocSchema) does NOT
  ```
- Produces (`scenarioInputWrite.ts`):
  ```ts
  export function dropClientOwnedInputs(modelId: string, inputs: Record<string, unknown>): Record<string, unknown>;
  export type RoadDistancesWrite = "keep" | "clear" | { set: RoadDistances };
  export interface ApplyScenarioInputWriteParams { scenarioId: number; userId: string; nextInputs: Record<string, unknown>; roadDistances?: RoadDistancesWrite }   // default "keep"
  ```
- Consumed by Task 8 (`RoadDistances`, `SuperInputs.roadDistances`) and Task 9 (`{ set }`).

- [ ] **Step 1: Failing tests.** `superModelRegistration.test.ts:55-67` — rename to "rejects non-finite numbers; accepts the road method (Phase 3)" and replace the last assertion with `expect(road.status).toBe(201); scenarioIds.push(road.body.id);`.

  `superRoadContract.test.ts` (helpers copied from `superNetworkImport.test.ts:11-42`, email prefix `sm2-7-`):

```ts
const road = (miles = 5) => ({ fetchedAt: "2026-10-23T00:00:00.000Z", profile: "driving-hgv",
  coords: { [sample.plants[0].id]: [sample.plants[0].lat, sample.plants[0].lng], [sample.warehouses[0].id]: [sample.warehouses[0].lat, sample.warehouses[0].lng] },
  pairs: [{ fromId: sample.plants[0].id, toId: sample.warehouses[0].id, miles }] });
const stored = async (id: number) => (await db.select().from(scenariosTable).where(eq(scenariosTable.id, id)))[0]!.inputs as Record<string, unknown>;
const seedRoad = async (id: number, value: object) =>  // stand-in for the server-only road route (Task 9): a direct row write
  db.update(scenariosTable).set({ inputs: { ...(await stored(id)), roadDistances: value } }).where(eq(scenariosTable.id, id));

describe("SM2-7 roadDistances is server-written only", () => {
  it("setup", async () => { cookie = await registerAndGetCookie(); });
  it("POST create drops a client roadDistances", async () => {
    const id = await create("super-model", { ...SUPER_DEFAULT_INPUTS, distanceMethod: "road", roadDistances: road() });
    expect((await stored(id)).roadDistances).toBeUndefined();
    expect((await stored(id)).distanceMethod).toBe("road");
  });
  it("PATCH cannot set, change or clear it; the persisted value is carried", async () => {
    const id = await createEmptySuper();
    await imp(id, "replace", sample).expect(200);
    await seedRoad(id, road(5));
    const inputs = (await get(id)).inputs;
    await request(app).patch(`/api/scenarios/${id}`).set("Cookie", cookie).send({ inputs: { ...inputs, roadDistances: road(999) } }).expect(200);
    expect((await stored(id)).roadDistances).toEqual(road(5));
    const { roadDistances: _r, ...without } = inputs;
    await request(app).patch(`/api/scenarios/${id}`).set("Cookie", cookie).send({ inputs: { ...without, p: 3 } }).expect(200);
    expect((await stored(id)).roadDistances).toEqual(road(5));
  });
  it("merge-import keeps it; replace-import clears it", async () => {
    const id = await createEmptySuper();
    await imp(id, "replace", sample).expect(200);
    await seedRoad(id, road(5));
    await imp(id, "merge", { p: 3 }).expect(200);
    expect((await stored(id)).roadDistances).toEqual(road(5));
    await imp(id, "replace", sample).expect(200);
    expect((await stored(id)).roadDistances).toBeUndefined();
  });
  it("the network document has no roadDistances: export omits it, import rejects it", async () => {
    const id = await createEmptySuper();
    await imp(id, "replace", sample).expect(200);
    await seedRoad(id, road(5));
    const exp = await request(app).get(`/api/scenarios/${id}/network/export?format=json`).set("Cookie", cookie).expect(200);
    expect(exp.body).not.toHaveProperty("roadDistances");
    expect((await imp(id, "merge", { roadDistances: road(1) })).status).toBe(422);
  });
  it("a schema-valid roadDistances round-trips through superInputsSchema; a wrong profile does not", () => {
    expect(superInputsSchema.safeParse({ ...SUPER_DEFAULT_INPUTS, roadDistances: road() }).success).toBe(true);
    expect(superInputsSchema.safeParse({ ...SUPER_DEFAULT_INPUTS, roadDistances: { ...road(), profile: "driving-car" } }).success).toBe(false);
  });
});
```

  Imports: `superInputsSchema` from `../validation/inputs/superInputs.js` (plus the copied helpers' imports).

- [ ] **Step 2: Run, expect FAIL:** `DATABASE_URL="postgresql://shubhamkr@localhost:5432/nos_dev" pnpm --filter api-server exec vitest run src/__tests__/superRoadContract.test.ts src/__tests__/superModelRegistration.test.ts`

- [ ] **Step 3: Schema** (`superInputs.ts`):

```ts
// spec §3.2 / §8 — server-written by POST /network/road-distances only. Never part of the network document.
export const roadDistancesSchema = z.object({
  fetchedAt: z.string().datetime(),
  profile: z.literal("driving-hgv"),
  coords: z.record(z.string(), z.tuple([num, num])),          // [lat, lng] each location had when fetched (D8)
  pairs: z.array(z.object({ fromId: id, toId: id, miles: num.min(0) })),
});
export type RoadDistances = z.infer<typeof roadDistancesSchema>;
```
  `superParamSchemas.distanceMethod: z.enum(["haversine", "circuity", "road"])`; in `superInputsSchema`'s object add `roadDistances: roadDistancesSchema.optional(),` after `distanceOverrides`. `superNetworkDocSchema` is built from `superParamSchemas` + `superTableSchemas` (`services/superNetwork.ts:5-8`) and so excludes it unchanged.

  Manifest: `"distanceMethod": { "type": "string", "enum": ["haversine", "circuity", "road"] }` and `"roadDistances": { "type": "object", "description": "Server-written road distance cache (spec §8)." }` under `properties`; **not** in `required[]` (WF-5 gotcha). Label: `roadDistances: "Road distances",` in `INPUT_FIELD_LABELS` (the label-coverage test iterates every `properties` key).

- [ ] **Step 4: Write path** (`scenarioInputWrite.ts`):

```ts
import type { RoadDistances } from "../validation/inputs/superInputs.js";

export const SUPER_MODEL_ID = "super-model";
/** Keys only the server writes (spec §8). A client copy is dropped on EVERY write path — create, PATCH, import
 *  (api-server CLAUDE.md: a server-derived field needs its rule at every write site). Clone copies a server row and keeps it. */
export function dropClientOwnedInputs(modelId: string, inputs: Record<string, unknown>): Record<string, unknown> {
  if (modelId !== SUPER_MODEL_ID || !("roadDistances" in inputs)) return inputs;
  const { roadDistances: _clientCopy, ...rest } = inputs;
  return rest;
}
export type RoadDistancesWrite = "keep" | "clear" | { set: RoadDistances };
```
  `ApplyScenarioInputWriteParams` gains `/** super-model only; default "keep" (carry the persisted value). */ roadDistances?: RoadDistancesWrite;`. At `:85`, replace `validateInputsForModel(persisted.modelId, params.nextInputs)` with:

```ts
  const persistedInputs = (persisted.inputs ?? {}) as Record<string, unknown>;
  const road = params.roadDistances ?? "keep";
  const carried = persisted.modelId !== SUPER_MODEL_ID || road === "clear" ? undefined
    : road === "keep" ? persistedInputs.roadDistances : road.set;
  const candidate = dropClientOwnedInputs(persisted.modelId, params.nextInputs);
  const validation = validateInputsForModel(persisted.modelId, carried === undefined ? candidate : { ...candidate, roadDistances: carried });
```
  and delete the later duplicate `const persistedInputs = …` (`:93`). Every non-super model: `carried` is `undefined`, `candidate === nextInputs` — byte-identical behaviour.

- [ ] **Step 5: Call sites.** `routes/scenarios.ts:214`: `const validation = validateInputsForModel(body.modelId, body.inputs && typeof body.inputs === "object" ? dropClientOwnedInputs(body.modelId, body.inputs) : body.inputs);` (import from `../services/scenarioInputWrite.js`). `routes/superNetwork.ts` import: `applyScenarioInputWrite(tx, { scenarioId: id, userId: req.userId!, nextInputs: merged.next, roadDistances: mode === "replace" ? "clear" : "keep" })`. Export: `const { roadDistances: _server, ...doc } = superInputsSchema.parse(row.inputs); res.json(doc);`.

- [ ] **Step 6: Run** the two files (PASS), `pnpm --filter api-server exec vitest run src/validation/__tests__/formatInputIssues.test.ts src/__tests__/manifests.test.ts` (PASS), then `pnpm gate`.

- [ ] **Step 7: Commit** on `sm2-7-work`:
```bash
[ "$(git rev-parse --abbrev-ref HEAD)" != "main" ] || { echo "ON MAIN — commit refused"; exit 1; }
git add artifacts/api-server/src/__tests__/superRoadContract.test.ts
git commit artifacts/api-server/src/validation/inputs/superInputs.ts solvers/super-model/manifest.json artifacts/api-server/src/validation/formatInputIssues.ts artifacts/api-server/src/services/scenarioInputWrite.ts artifacts/api-server/src/routes/scenarios.ts artifacts/api-server/src/routes/superNetwork.ts artifacts/api-server/src/__tests__/superModelRegistration.test.ts artifacts/api-server/src/__tests__/superRoadContract.test.ts docs/CHANGELOG-implementation.md -m "[SM2-7] accept the road distance method and keep roadDistances server-written"
```

---
### Task 8 [SM2-8]: `validRoadPairs`, road readiness item, solve payload `roadPairs`, `merge_inputs.py` step 2

Role: backend-engineer, with the `merge_inputs.py` hunk on the solver-engineer-owned seam (AGENTS.md protocol 2: `SendMessage` solver-engineer with the `roadPairs` payload shape before editing; lead reviews both halves). One commit: the payload key is one contract across TS and Python.

**Files:**
- Create: `artifacts/api-server/src/services/superRoad.ts`
- Modify: `artifacts/api-server/src/services/precheckSuper.ts:22-25` (road item before the coefficient check)
- Modify: `artifacts/api-server/src/solver/pmedian.ts:217-219`
- Modify: `artifacts/api-server/src/solver/merge_inputs.py:1079-1108` (`build_super_dataset`)
- Create: `artifacts/api-server/src/__tests__/superRoad.test.ts`
- Modify: `artifacts/api-server/src/__tests__/precheckSuper.test.ts`, `artifacts/api-server/src/solver/tests/test_super.py`

**Interfaces:**
- Consumes: Task 7's `SuperInputs.roadDistances`, `RoadDistances`.
- Produces (`services/superRoad.ts`):
  ```ts
  export interface RoadPair { fromId: string; toId: string; miles: number }
  /** D8: a stored pair is valid iff both endpoints exist now and their current lat/lng equal coords exactly. The ONLY implementation. */
  export function validRoadPairs(v: SuperInputs): RoadPair[];
  /** Required = plant→eligible WH and eligible WH→active customer, without a distanceOverride; returns how many lack a valid road pair. */
  export function missingRequiredRoadPairs(v: SuperInputs): number;
  ```
- Produces (solver payload, `modelType: "super_model"`): every `SuperInputs` key except `roadDistances`, plus `roadPairs: RoadPair[]` (valid pairs when `distanceMethod === "road"`, else `[]`).
- Python resolution per pair: `distanceOverrides` → `roadPairs` → haversine × (`circuityFactor` iff `distanceMethod == "circuity"`). No validity logic in Python.

- [ ] **Step 1: Failing TS tests** (`src/__tests__/superRoad.test.ts`):

```ts
import { describe, it, expect } from "vitest";
import { superInputsSchema, SUPER_DEFAULT_INPUTS } from "../validation/inputs/superInputs.js";
import { missingRequiredRoadPairs, validRoadPairs } from "../services/superRoad.js";
import { buildPayload } from "../solver/pmedian.js";

const net = (over: object = {}) => superInputsSchema.parse({
  ...SUPER_DEFAULT_INPUTS, distanceMethod: "road", p: 1,
  products: [{ id: "K", name: "K" }],
  plants: [{ id: "P", name: "P", lat: 1, lng: 1 }],
  warehouses: [{ id: "W1", name: "W1", lat: 2, lng: 2, status: "active" }, { id: "W2", name: "W2", lat: 3, lng: 3, status: "inactive" }],
  customers: [{ id: "C1", name: "C1", lat: 4, lng: 4, status: "active" }, { id: "C2", name: "C2", lat: 5, lng: 5, status: "excluded" }],
  plantProducts: [{ plantId: "P", productId: "K", capacity: 10, costPerUnit: 0 }],
  demand: [{ customerId: "C1", productId: "K", demand: 1 }],
  roadDistances: { fetchedAt: "2026-10-23T00:00:00.000Z", profile: "driving-hgv",
    coords: { P: [1, 1], W1: [2, 2], W2: [3, 3], C1: [4, 4], C2: [5, 5] },
    pairs: [{ fromId: "P", toId: "W1", miles: 10 }, { fromId: "W1", toId: "C1", miles: 20 }, { fromId: "P", toId: "W2", miles: 30 }] },
  ...over,
});

describe("validRoadPairs (D8)", () => {
  it("keeps pairs whose endpoints exist at the snapshot coordinates", () => {
    expect(validRoadPairs(net()).map(p => `${p.fromId}|${p.toId}`)).toEqual(["P|W1", "W1|C1", "P|W2"]);
  });
  it("a moved or removed endpoint invalidates its pairs only", () => {
    const moved = net({ customers: [{ id: "C1", name: "C1", lat: 4.0001, lng: 4, status: "active" }] });
    expect(validRoadPairs(moved).map(p => p.toId)).toEqual(["W1", "W2"]);
    const gone = net({ warehouses: [{ id: "W1", name: "W1", lat: 2, lng: 2, status: "active" }] });
    expect(validRoadPairs(gone).map(p => p.toId)).toEqual(["W1", "C1"]);
  });
  it("no roadDistances -> none", () => expect(validRoadPairs(net({ roadDistances: undefined }))).toEqual([]));
});

describe("required road pairs (readiness)", () => {
  it("complete when every required pair is valid; inactive / excluded never block", () => {
    expect(missingRequiredRoadPairs(net())).toBe(0);
  });
  it("counts a stale required pair; an override covers it", () => {
    const moved = net({ customers: [{ id: "C1", name: "C1", lat: 9, lng: 9, status: "active" }, { id: "C2", name: "C2", lat: 5, lng: 5, status: "excluded" }] });
    expect(missingRequiredRoadPairs(moved)).toBe(1);
    expect(missingRequiredRoadPairs({ ...moved, distanceOverrides: [{ fromId: "W1", toId: "C1", miles: 3 }] })).toBe(0);
  });
});

describe("solve payload", () => {
  it("passes only valid pairs as roadPairs and never roadDistances", () => {
    const moved = net({ customers: [{ id: "C1", name: "C1", lat: 9, lng: 9, status: "active" }] });
    const payload = buildPayload({ modelId: "super-model", inputs: moved }) as Record<string, unknown>;
    expect(payload).not.toHaveProperty("roadDistances");
    expect(payload.roadPairs).toEqual([{ fromId: "P", toId: "W1", miles: 10 }, { fromId: "P", toId: "W2", miles: 30 }]);
    expect((buildPayload({ modelId: "super-model", inputs: net({ distanceMethod: "haversine" }) }) as Record<string, unknown>).roadPairs).toEqual([]);
  });
});
```

  `buildPayload(input: SolveInput): Record<string, unknown>` is exported at `solver/pmedian.ts:23`; the casts above are therefore unnecessary but harmless.

  `precheckSuper.test.ts` gains:

```ts
  it("SM2-8: method road -> one completeness item counting required pairs; overrides and a full cache clear it", () => {
    // sample: 4 plants x 25 eligible WH + 25 WH x 100 active customers = 2600 required pairs (computed from the sample)
    const road = (o: object) => precheckSuperInputs(S({ distanceMethod: "road", ...o })).errors.filter(e => /road distance/.test(e.message));
    const noOverrides = road({ distanceOverrides: [] });
    expect(noOverrides).toHaveLength(1);
    expect(noOverrides[0].code).toBe("completeness");
    expect(noOverrides[0].message).toMatch(/^2600 required road distance pair/);
    expect(road({})).toEqual([]);   // the sample overrides all 2600 pairs, so nothing is required
  });
```

- [ ] **Step 2: Failing pytest** (`tests/test_super.py`, after `test_distance_resolution_precedence`):

```python
def test_road_pairs_resolution_step_2():
    road = [{"fromId": "P1", "toId": "W1", "miles": 111.5}, {"fromId": "W1", "toId": "C1", "miles": 222.25}]
    ds = build_super_dataset(_mini_inputs(distanceMethod="road", roadPairs=road,
                                          distanceOverrides=[{"fromId": "W1", "toId": "C1", "miles": 7}]))
    assert ds["dist"][("P1", "W1")] == 111.5          # passed road pair
    assert ds["dist"][("W1", "C1")] == 7              # override still wins
    hv = haversine_mi(40.0, -100.0, 40.0, -99.0)
    ds2 = build_super_dataset(_mini_inputs(distanceMethod="road", roadPairs=[]))
    assert abs(ds2["dist"][("P1", "W1")] - hv) < 1e-9  # no pair passed -> haversine, factor 1
```

- [ ] **Step 3: Run, expect FAIL:**
  `DATABASE_URL="postgresql://shubhamkr@localhost:5432/nos_dev" pnpm --filter api-server exec vitest run src/__tests__/superRoad.test.ts src/__tests__/precheckSuper.test.ts` and
  `cd artifacts/api-server/src/solver && python3 -m pytest tests/test_super.py -x -k road`

- [ ] **Step 4: `services/superRoad.ts`:**

```ts
import type { SuperInputs } from "../validation/inputs/superInputs.js";

export interface RoadPair { fromId: string; toId: string; miles: number }
const key = (a: string, b: string) => `${a}|${b}`;

/** D8 — the only road-validity implementation (precheck and the solve payload both call it; Python and the Studio never
 *  recompute it). Exact equality is intended: both sides are the same stored JSON numbers, and a move writes new numbers. */
export function validRoadPairs(v: SuperInputs): RoadPair[] {
  const rd = v.roadDistances;
  if (!rd) return [];
  const at = new Map([...v.plants, ...v.warehouses, ...v.customers].map(l => [l.id, l]));
  const same = (id: string) => {
    const l = at.get(id), c = rd.coords[id];
    return !!l && !!c && l.lat === c[0] && l.lng === c[1];
  };
  return rd.pairs.filter(p => same(p.fromId) && same(p.toId));
}

/** §8 readiness: required = plant→eligible WH and eligible WH→active customer, minus overridden pairs. */
export function missingRequiredRoadPairs(v: SuperInputs): number {
  const valid = new Set(validRoadPairs(v).map(p => key(p.fromId, p.toId)));
  const overridden = new Set(v.distanceOverrides.map(o => key(o.fromId, o.toId)));
  const eligible = v.warehouses.filter(w => w.status !== "inactive");
  const active = v.customers.filter(c => c.status !== "excluded");
  let missing = 0;
  const need = (a: string, b: string) => { const k = key(a, b); if (!overridden.has(k) && !valid.has(k)) missing++; };
  for (const p of v.plants) for (const w of eligible) need(p.id, w.id);
  for (const w of eligible) for (const c of active) need(w.id, c.id);
  return missing;
}
```

  `precheckSuper.ts`, before the coefficient check:

```ts
  if (v.distanceMethod === "road") {
    const missing = missingRequiredRoadPairs(v);
    if (missing > 0) err("completeness", `${missing} required road distance pair(s) are missing or out of date. Fetch road distances, or add distance overrides.`);
  }
```
  (Reuses `completeness`; no new closed-union precheck code — open issue 13.)

  `pmedian.ts:217-219`:

```ts
  if (input.modelId === "super-model") {
    // spec §8: Python receives only valid road pairs and never the cache itself (D8 validity stays server-side).
    const { roadDistances: _cache, ...inputs } = input.inputs;
    return { modelType: "super_model", ...inputs, roadPairs: inputs.distanceMethod === "road" ? validRoadPairs(input.inputs) : [] };
  }
```

- [ ] **Step 5: `merge_inputs.py`** (`build_super_dataset`) — one more lookup table, no new branch on business rules:

```python
    overrides = {(r["fromId"], r["toId"]): float(r["miles"]) for r in inputs.get("distanceOverrides", [])}
    # spec §8 step 2: road pairs arrive already validated by the API (validRoadPairs); none -> {}.
    road = {(r["fromId"], r["toId"]): float(r["miles"]) for r in inputs.get("roadPairs", [])}
    factor = float(inputs.get("circuityFactor", 1.0)) if inputs.get("distanceMethod") == "circuity" else 1.0

    def resolve(a, b):
        pair = (a["id"], b["id"])
        if pair in overrides:
            return overrides[pair]
        if pair in road:
            return road[pair]
        return haversine_mi(a["lat"], a["lng"], b["lat"], b["lng"]) * factor
```
  Update the docstring: "Overrides win; then road pairs passed by the API; otherwise haversine miles, x circuityFactor when distanceMethod == "circuity"."

- [ ] **Step 6: Run** the TS files and pytest (PASS); then `cd artifacts/api-server/src/solver && python3 -m pytest tests/ -x`, `cd tests && python3 e2e_accuracy.py` (99/99, unmodified), and `pnpm gate`. `SOLVER_CODE_HASH` already covers `merge_inputs.py` (SM-2): every cached result misses once after deploy — note it in the changelog.

- [ ] **Step 7: Commit** on `sm2-8-work`:
```bash
[ "$(git rev-parse --abbrev-ref HEAD)" != "main" ] || { echo "ON MAIN — commit refused"; exit 1; }
git add artifacts/api-server/src/services/superRoad.ts artifacts/api-server/src/__tests__/superRoad.test.ts
git commit artifacts/api-server/src/services/superRoad.ts artifacts/api-server/src/services/precheckSuper.ts artifacts/api-server/src/solver/pmedian.ts artifacts/api-server/src/solver/merge_inputs.py artifacts/api-server/src/__tests__/superRoad.test.ts artifacts/api-server/src/__tests__/precheckSuper.test.ts artifacts/api-server/src/solver/tests/test_super.py docs/CHANGELOG-implementation.md -m "[SM2-8] derive valid road pairs once and resolve them in the super-model solve"
```

---

### Task 9 [SM2-9]: ORS client, process-wide queue, error codes, `POST /network/road-distances`

Role: backend-engineer. Contract task: TS error-code union, OpenAPI enum and regenerated clients in this commit.

**Files:**
- Create: `artifacts/api-server/src/services/orsClient.ts`
- Modify: `artifacts/api-server/src/routes/superNetwork.ts` (new handler)
- Modify: `lib/api-spec/openapi.yaml` (path after `/scenarios/{scenarioId}/network/export`, `:469`; schemas `RoadDistancesErrorCode`, `RoadDistancesError`), regen
- Create: `artifacts/api-server/src/__tests__/orsClient.test.ts`, `artifacts/api-server/src/__tests__/superRoadRoute.test.ts`

**Interfaces:**
- Produces (`services/orsClient.ts`):
  ```ts
  export type RoadDistancesErrorCode = "road_distances_unavailable" | "road_distances_quota" | "road_distances_failed" | "road_distances_unroutable";
  export const ROAD_ERROR_STATUS: Record<RoadDistancesErrorCode, number>;   // 503 / 429 / 502 / 422
  export class RoadDistancesError extends Error { readonly code: RoadDistancesErrorCode }
  export const ORS_MATRIX_URL = "https://api.openrouteservice.org/v2/matrix/driving-hgv";
  export const ORS_MAX_PAIRS = 3500, ORS_REQUEST_TIMEOUT_MS = 30_000, ORS_DEADLINE_MS = 120_000;
  export interface OrsLocation { id: string; lat: number; lng: number }
  export interface OrsBatch { label: string; sources: OrsLocation[]; destinations: OrsLocation[] }
  export function planBatches(plants: OrsLocation[], warehouses: OrsLocation[], customers: OrsLocation[]): OrsBatch[];
  export function fetchRoadPairs(o: { apiKey: string; batches: OrsBatch[]; fetchImpl?: typeof fetch; requestTimeoutMs?: number; deadlineMs?: number }): Promise<RoadPair[]>;
  export function runExclusive<T>(task: () => Promise<T>): Promise<T>;
  export function orsFetch(): typeof fetch;
  export function setOrsFetchForTests(f: typeof fetch | null): void;   // test-only seam, same pattern as setLockedModelsForTests
  ```
- Wire: `POST /api/scenarios/:id/network/road-distances`, empty body. 200 `{ scenario }`; 401; 403 locked; 404 non-owned / non-super / gone; 422 `invalid` → `{ error, issues }`; error codes → `{ error: <code>, message }` with `ROAD_ERROR_STATUS`. OpenAPI operationId `fetchScenarioRoadDistances` (Task 10 consumes `useFetchScenarioRoadDistances`, `RoadDistancesErrorCode`).

- [ ] **Step 1: Failing client tests** (`src/__tests__/orsClient.test.ts`):

```ts
import { describe, it, expect, vi } from "vitest";
import { fetchRoadPairs, planBatches, runExclusive, type OrsLocation } from "../services/orsClient.js";

const locs = (p: string, n: number): OrsLocation[] => Array.from({ length: n }, (_, i) => ({ id: `${p}${i + 1}`, lat: i + 0.5, lng: -(i + 0.25) }));
/** Answers every request with distances[s][d] = 1000*s + d; records each parsed body. */
function stub(bodies: Record<string, unknown>[] = []) {
  return vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    const b = JSON.parse(String(init!.body));
    bodies.push(b);
    return new Response(JSON.stringify({ distances: b.sources.map((_: number, s: number) => b.destinations.map((_: number, d: number) => 1000 * s + d)) }));
  }) as unknown as typeof fetch;
}

describe("planBatches at the §3.3 caps", () => {
  it("1 plants×warehouses request + ceil(500/70) customer chunks", () => {
    const b = planBatches(locs("P", 20), locs("W", 50), locs("C", 500));
    expect(b).toHaveLength(9);
    expect(b[0]).toMatchObject({ label: "plants → warehouses" });
    expect(b.slice(1).every(x => x.sources.length === 50 && x.destinations.length <= 70)).toBe(true);
    expect(b[1].label).toBe("warehouses → customers 1–70");
    expect(b[8].label).toBe("warehouses → customers 491–500");
    expect(b.every(x => x.sources.length * x.destinations.length <= 3500)).toBe(true);
  });
  it("no warehouses -> no requests", () => expect(planBatches(locs("P", 2), [], locs("C", 3))).toEqual([]));
});

describe("fetchRoadPairs", () => {
  it("sends [lng, lat], index sources/destinations, distance in miles, the key header; maps the matrix to pairs", async () => {
    const bodies: Record<string, unknown>[] = [];
    const f = stub(bodies);
    const pairs = await fetchRoadPairs({ apiKey: "KEY", batches: planBatches(locs("P", 1), locs("W", 2), locs("C", 1)), fetchImpl: f });
    const [url, init] = vi.mocked(f).mock.calls[0];
    expect(url).toBe("https://api.openrouteservice.org/v2/matrix/driving-hgv");
    expect((init!.headers as Record<string, string>).Authorization).toBe("KEY");
    expect(bodies[0]).toEqual({ locations: [[-0.25, 0.5], [-0.25, 0.5], [-1.25, 1.5]], sources: [0], destinations: [1, 2], metrics: ["distance"], units: "mi" });
    expect(pairs).toEqual([
      { fromId: "P1", toId: "W1", miles: 0 }, { fromId: "P1", toId: "W2", miles: 1 },
      { fromId: "W1", toId: "C1", miles: 0 }, { fromId: "W2", toId: "C1", miles: 1000 },
    ]);
  });
  it("429 -> road_distances_quota; 500 -> road_distances_failed naming the batch; null -> unroutable naming the pair", async () => {
    const batches = planBatches(locs("P", 1), locs("W", 1), locs("C", 1));
    await expect(fetchRoadPairs({ apiKey: "k", batches, fetchImpl: (async () => new Response("", { status: 429 })) as typeof fetch }))
      .rejects.toMatchObject({ code: "road_distances_quota" });
    await expect(fetchRoadPairs({ apiKey: "k", batches, fetchImpl: (async () => new Response("", { status: 500 })) as typeof fetch }))
      .rejects.toMatchObject({ code: "road_distances_failed", message: expect.stringContaining("plants → warehouses") });
    await expect(fetchRoadPairs({ apiKey: "k", batches, fetchImpl: (async () => new Response(JSON.stringify({ distances: [[null]] }))) as typeof fetch }))
      .rejects.toMatchObject({ code: "road_distances_unroutable", message: expect.stringContaining("P1 to W1") });
  });
  it("a per-request timeout and the overall deadline both fail as road_distances_failed; no retries", async () => {
    const hang = vi.fn((_u: unknown, init?: RequestInit) => new Promise<Response>((_, reject) =>
      init!.signal!.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))))) as unknown as typeof fetch;
    const batches = planBatches(locs("P", 1), locs("W", 1), locs("C", 1));
    await expect(fetchRoadPairs({ apiKey: "k", batches, fetchImpl: hang, requestTimeoutMs: 20 })).rejects.toMatchObject({ code: "road_distances_failed" });
    expect(vi.mocked(hang)).toHaveBeenCalledTimes(1);
    await expect(fetchRoadPairs({ apiKey: "k", batches, fetchImpl: hang, requestTimeoutMs: 10_000, deadlineMs: 20 })).rejects.toMatchObject({ code: "road_distances_failed" });
  });
  it("runExclusive never overlaps two fetches, and a failure does not block the next", async () => {
    const order: string[] = [];
    const slow = (n: string, fail = false) => () => new Promise<string>((res, rej) => { order.push(`start ${n}`); setTimeout(() => { order.push(`end ${n}`); fail ? rej(new Error(n)) : res(n); }, 10); });
    const a = runExclusive(slow("a", true)), b = runExclusive(slow("b"));
    await expect(a).rejects.toThrow("a");
    await expect(b).resolves.toBe("b");
    expect(order).toEqual(["start a", "end a", "start b", "end b"]);
  });
});
```

- [ ] **Step 2: Failing route tests** (`src/__tests__/superRoadRoute.test.ts`; helpers copied from `superNetworkImport.test.ts:11-42`, prefix `sm2-9-`). A tiny network keeps request counts readable; the cap batching is proven in Step 1.

```ts
import { setOrsFetchForTests } from "../services/orsClient.js";
import { validRoadPairs } from "../services/superRoad.js";
import { superInputsSchema } from "../validation/inputs/superInputs.js";

const tiny = { ...SUPER_DEFAULT_INPUTS, distanceMethod: "road", p: 1,
  products: [{ id: "K", name: "K" }], plants: [{ id: "P", name: "P", lat: 1, lng: 1 }],
  warehouses: [{ id: "W", name: "W", lat: 2, lng: 2, status: "active" }], customers: [{ id: "C", name: "C", lat: 3, lng: 3, status: "active" }],
  plantProducts: [{ plantId: "P", productId: "K", capacity: 10, costPerUnit: 0 }], demand: [{ customerId: "C", productId: "K", demand: 1 }] };
const okFetch = (onCall?: () => Promise<void>) => (async (_u: unknown, init?: RequestInit) => {
  await onCall?.();
  const b = JSON.parse(String(init!.body));
  return new Response(JSON.stringify({ distances: b.sources.map(() => b.destinations.map(() => 42.5)) }));
}) as typeof fetch;
const fetchRoad = (id: number, c = cookie) => request(app).post(`/api/scenarios/${id}/network/road-distances`).set("Cookie", c);
const stored = async (id: number) => (await db.select().from(scenariosTable).where(eq(scenariosTable.id, id)))[0]!;

afterEach(() => { setOrsFetchForTests(null); delete process.env.ORS_API_KEY; });

describe("POST /network/road-distances", () => {
  it("setup", async () => { cookie = await registerAndGetCookie(); });
  it("missing ORS_API_KEY -> 503 road_distances_unavailable, nothing written", async () => {
    const id = await create("super-model", tiny);
    const res = await fetchRoad(id);
    expect(res.status).toBe(503);
    expect(res.body.error).toBe("road_distances_unavailable");
    expect(JSON.stringify(res.body)).not.toContain("KEY");
    expect((await stored(id)).inputs).not.toHaveProperty("roadDistances");
  });
  it("another user's scenario and a non-super scenario are 404", async () => {
    process.env.ORS_API_KEY = "KEY"; setOrsFetchForTests(okFetch());
    const id = await create("super-model", tiny);
    expect((await fetchRoad(id, await registerAndGetCookie())).status).toBe(404);
    expect((await fetchRoad(await createJade())).status).toBe(404);
  });
  it("success writes only roadDistances, bumps inputsUpdatedAt, and readiness / payload use the pairs", async () => {
    process.env.ORS_API_KEY = "KEY"; setOrsFetchForTests(okFetch());
    const id = await create("super-model", tiny);
    const before = await stored(id);
    const res = await fetchRoad(id).expect(200);
    const after = await stored(id);
    const inputs = superInputsSchema.parse(after.inputs);
    expect(inputs.roadDistances).toMatchObject({ profile: "driving-hgv", coords: { P: [1, 1], W: [2, 2], C: [3, 3] } });
    expect(inputs.roadDistances!.pairs).toEqual([{ fromId: "P", toId: "W", miles: 42.5 }, { fromId: "W", toId: "C", miles: 42.5 }]);
    expect(after.inputsUpdatedAt.getTime()).toBeGreaterThan(before.inputsUpdatedAt.getTime());
    expect(res.body.scenario.inputs.roadDistances.pairs).toHaveLength(2);
    expect((await request(app).get(`/api/scenarios/${id}/precheck`).set("Cookie", cookie)).body.ok).toBe(true);
  });
  it("429, null and timeout each write nothing", async () => {
    process.env.ORS_API_KEY = "KEY";
    const id = await create("super-model", tiny);
    for (const [f, code, status] of [
      [(async () => new Response("", { status: 429 })) as typeof fetch, "road_distances_quota", 429],
      [(async () => new Response(JSON.stringify({ distances: [[null]] }))) as typeof fetch, "road_distances_unroutable", 422],
      [(async () => { throw new DOMException("t", "TimeoutError"); }) as typeof fetch, "road_distances_failed", 502],
    ] as const) {
      setOrsFetchForTests(f);
      const res = await fetchRoad(id);
      expect([res.status, res.body.error]).toEqual([status, code]);
      expect((await stored(id)).inputs).not.toHaveProperty("roadDistances");
    }
  });
  it("a PATCH landing between fetch and write is kept; the moved location's pairs are stale", async () => {
    process.env.ORS_API_KEY = "KEY";
    const id = await create("super-model", tiny);
    setOrsFetchForTests(okFetch(async () => {
      await request(app).patch(`/api/scenarios/${id}`).set("Cookie", cookie)
        .send({ inputs: { ...tiny, customers: [{ id: "C", name: "C", lat: 3.5, lng: 3, status: "active" }] } }).expect(200);
    }));
    await fetchRoad(id).expect(200);
    const inputs = superInputsSchema.parse((await stored(id)).inputs);
    expect(inputs.customers[0].lat).toBe(3.5);                       // concurrent edit kept
    expect(inputs.roadDistances!.coords.C).toEqual([3, 3]);           // phase-1 snapshot
    expect(validRoadPairs(inputs).map(p => p.toId)).toEqual(["W"]);   // W→C is stale
  });
  it("solve uses the valid road pair and an override still wins", async () => {
    // payload-level proof lives in superRoad.test.ts (buildPayload) and test_super.py (resolution order);
    // here: the route's output is accepted by buildPayload unchanged.
    process.env.ORS_API_KEY = "KEY"; setOrsFetchForTests(okFetch());
    const id = await create("super-model", { ...tiny, distanceOverrides: [{ fromId: "W", toId: "C", miles: 1 }] });
    await fetchRoad(id).expect(200);
    const { buildPayload } = await import("../solver/pmedian.js");
    const payload = buildPayload({ modelId: "super-model", inputs: superInputsSchema.parse((await stored(id)).inputs) }) as Record<string, unknown>;
    expect(payload.roadPairs).toHaveLength(2);
    expect(payload.distanceOverrides).toEqual([{ fromId: "W", toId: "C", miles: 1 }]);
  });
});
```

  `afterEach` from vitest. The locked-model case is covered by `lockedModelGuards.test.ts`, which scans `routes/superNetwork.ts` (SM-16) and fails if the new handler lacks an `isModelLocked` check before its first write.

- [ ] **Step 3: Run, expect FAIL:** `DATABASE_URL="postgresql://shubhamkr@localhost:5432/nos_dev" pnpm --filter api-server exec vitest run src/__tests__/orsClient.test.ts src/__tests__/superRoadRoute.test.ts`

- [ ] **Step 4: `services/orsClient.ts`:**

```ts
// SM2-9 (spec §8, D7/D9) — OpenRouteService matrix client. Tests inject fetch; nothing here ever logs the key.
import type { RoadPair } from "./superRoad.js";

export type RoadDistancesErrorCode = "road_distances_unavailable" | "road_distances_quota" | "road_distances_failed" | "road_distances_unroutable";
export const ROAD_ERROR_STATUS: Record<RoadDistancesErrorCode, number> = {
  road_distances_unavailable: 503, road_distances_quota: 429, road_distances_failed: 502, road_distances_unroutable: 422,
};
export class RoadDistancesError extends Error {
  constructor(readonly code: RoadDistancesErrorCode, message: string) { super(message); this.name = "RoadDistancesError"; }
}
export const ORS_MATRIX_URL = "https://api.openrouteservice.org/v2/matrix/driving-hgv";
export const ORS_MAX_PAIRS = 3500;
export const ORS_REQUEST_TIMEOUT_MS = 30_000;
export const ORS_DEADLINE_MS = 120_000;
const QUOTA = "OpenRouteService quota reached, try again later. The daily quota is shared by everyone using this server.";

export interface OrsLocation { id: string; lat: number; lng: number }
export interface OrsBatch { label: string; sources: OrsLocation[]; destinations: OrsLocation[] }

/** §8: all plants × all warehouses, then customers in chunks of floor(3500 / warehouses) with every warehouse as a source. */
export function planBatches(plants: OrsLocation[], warehouses: OrsLocation[], customers: OrsLocation[]): OrsBatch[] {
  if (warehouses.length === 0) return [];
  const out: OrsBatch[] = [];
  if (plants.length > 0) out.push({ label: "plants → warehouses", sources: plants, destinations: warehouses });
  const chunk = Math.floor(ORS_MAX_PAIRS / warehouses.length);
  for (let i = 0; i < customers.length; i += chunk)
    out.push({ label: `warehouses → customers ${i + 1}–${Math.min(i + chunk, customers.length)}`, sources: warehouses, destinations: customers.slice(i, i + chunk) });
  return out;
}

export async function fetchRoadPairs(o: { apiKey: string; batches: OrsBatch[]; fetchImpl?: typeof fetch; requestTimeoutMs?: number; deadlineMs?: number }): Promise<RoadPair[]> {
  const fetchImpl = o.fetchImpl ?? fetch;
  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(), o.deadlineMs ?? ORS_DEADLINE_MS);
  const pairs: RoadPair[] = [];
  try {
    for (const b of o.batches) {                                     // serial, no retries (§8)
      const body = {
        locations: [...b.sources, ...b.destinations].map(l => [l.lng, l.lat]),   // ORS wants [longitude, latitude]
        sources: b.sources.map((_, i) => i),
        destinations: b.destinations.map((_, j) => b.sources.length + j),
        metrics: ["distance"], units: "mi",
      };
      let res: Response;
      try {
        res = await fetchImpl(ORS_MATRIX_URL, {
          method: "POST",
          headers: { Authorization: o.apiKey, "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify(body),
          signal: AbortSignal.any([deadline.signal, AbortSignal.timeout(o.requestTimeoutMs ?? ORS_REQUEST_TIMEOUT_MS)]),
        });
      } catch {                                                       // no binding: nothing from the request can leak
        throw new RoadDistancesError("road_distances_failed", `OpenRouteService did not answer for ${b.label} (timed out or unreachable).`);
      }
      if (res.status === 429) throw new RoadDistancesError("road_distances_quota", QUOTA);
      if (!res.ok) throw new RoadDistancesError("road_distances_failed", `OpenRouteService failed for ${b.label} (HTTP ${res.status}).`);
      const d = ((await res.json().catch(() => null)) as { distances?: unknown } | null)?.distances;
      if (!Array.isArray(d) || d.length !== b.sources.length)
        throw new RoadDistancesError("road_distances_failed", `OpenRouteService returned an unexpected response for ${b.label}.`);
      b.sources.forEach((s, i) => b.destinations.forEach((t, j) => {
        const miles = (d[i] as unknown[] | undefined)?.[j];
        if (miles === null) throw new RoadDistancesError("road_distances_unroutable", `No road route from ${s.id} to ${t.id}. Add a distance override for that pair.`);
        if (typeof miles !== "number" || !Number.isFinite(miles))
          throw new RoadDistancesError("road_distances_failed", `OpenRouteService returned an unexpected response for ${b.label}.`);
        pairs.push({ fromId: s.id, toId: t.id, miles });             // unrounded (§8)
      }));
    }
    return pairs;
  } finally {
    clearTimeout(timer);
  }
}

// ponytail: single-instance queue; a shared limiter is needed only if nos-api scales past one instance.
let tail: Promise<unknown> = Promise.resolve();
export function runExclusive<T>(task: () => Promise<T>): Promise<T> {
  const run = tail.then(task, task);
  tail = run.catch(() => undefined);
  return run;
}

let fetchForTests: typeof fetch | null = null;
/** Test-only seam (module variable, not an env var or config flag), same pattern as setLockedModelsForTests. */
export function setOrsFetchForTests(f: typeof fetch | null): void { fetchForTests = f; }
export function orsFetch(): typeof fetch { return fetchForTests ?? fetch; }
```

  The route-level timeout case throws a `DOMException` from `fetchImpl`, which the no-binding `catch` maps to `road_distances_failed` (502).

- [ ] **Step 5: Route** (append to `routes/superNetwork.ts` before `export default`):

```ts
import { ROAD_ERROR_STATUS, RoadDistancesError, fetchRoadPairs, orsFetch, planBatches, runExclusive } from "../services/orsClient.js";
import type { RoadPair } from "../services/superRoad.js";

// SM2-9 (spec §8, D7) — synchronous; ORS is called with NO row lock, then only roadDistances is written onto the row's
// CURRENT inputs. A concurrent edit is never overwritten; a location it moved no longer matches `coords`, so D8 marks its pairs stale.
router.post("/scenarios/:scenarioId/network/road-distances", async (req: Request, res: Response) => {
  const id = Number(req.params.scenarioId);
  const row = Number.isInteger(id) ? await loadOwnedSuper(id, req.userId!) : null;
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  if (isModelLocked(row.modelId)) { respondLocked(res); return; }
  const apiKey = process.env.ORS_API_KEY;
  if (!apiKey) {
    res.status(ROAD_ERROR_STATUS.road_distances_unavailable).json({ error: "road_distances_unavailable", message: "Road distances are not available: no OpenRouteService key is configured on this server." });
    return;
  }
  const v = superInputsSchema.parse(row.inputs);                                       // phase 1: snapshot, no lock
  const coords = Object.fromEntries([...v.plants, ...v.warehouses, ...v.customers].map(l => [l.id, [l.lat, l.lng] as [number, number]]));
  let pairs: RoadPair[];
  try {
    pairs = await runExclusive(() => fetchRoadPairs({ apiKey, batches: planBatches(v.plants, v.warehouses, v.customers), fetchImpl: orsFetch() }));
  } catch (e) {
    if (e instanceof RoadDistancesError) { res.status(ROAD_ERROR_STATUS[e.code]).json({ error: e.code, message: e.message }); return; }
    throw e;
  }
  const roadDistances = { fetchedAt: new Date().toISOString(), profile: "driving-hgv" as const, coords, pairs };
  const outcome = await db.transaction(async tx => {                                   // phase 3: lock and write onto CURRENT inputs
    const [cur] = await tx.select().from(scenariosTable)
      .where(and(eq(scenariosTable.id, id), eq(scenariosTable.userId, req.userId!))).for("update");
    if (!cur) return { kind: "not_found" as const };
    return applyScenarioInputWrite(tx, { scenarioId: id, userId: req.userId!, nextInputs: cur.inputs as Record<string, unknown>, roadDistances: { set: roadDistances } });
  });
  if (outcome.kind === "not_found") { res.status(404).json({ error: "Not found" }); return; }
  if (outcome.kind === "invalid") { res.status(422).json({ error: outcome.error, issues: outcome.issues }); return; }
  res.json({ scenario: toApiScenario(outcome.row) });
});
```

  Body: the global 100 KiB parser handles the empty body (`app.ts:79-83`); no carve-out.

- [ ] **Step 6: OpenAPI.**

```yaml
  /scenarios/{scenarioId}/network/road-distances:
    post:
      operationId: fetchScenarioRoadDistances
      tags: [scenarios]
      summary: Fetch OpenRouteService road distances for every plant→warehouse and warehouse→customer pair (super-model)
      description: >-
        Synchronous (up to 120 s). Sends every location's coordinates to OpenRouteService
        (driving-hgv), then writes only `inputs.roadDistances` onto the scenario's current
        inputs. Any failure writes nothing. Non-owned or non-super scenario is 404.
      parameters:
        - name: scenarioId
          in: path
          required: true
          schema:
            type: integer
      responses:
        "200":
          description: The updated scenario
          content:
            application/json:
              schema:
                type: object
                required: [scenario]
                properties:
                  scenario:
                    $ref: "#/components/schemas/Scenario"
        "401":
          description: Not authenticated
        "403":
          description: Model is locked
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/ErrorEnvelope"
        "404":
          description: Not found (also another user's scenario or a non-super scenario, never 403)
        "422":
          description: road_distances_unroutable, or the resulting inputs failed validation
          content:
            application/json:
              schema:
                oneOf:
                  - $ref: "#/components/schemas/RoadDistancesError"
                  - $ref: "#/components/schemas/NetworkImportRejection"
        "429":
          description: road_distances_quota
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/RoadDistancesError"
        "502":
          description: road_distances_failed (timeout, deadline or an OpenRouteService error)
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/RoadDistancesError"
        "503":
          description: road_distances_unavailable (no ORS_API_KEY on the server)
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/RoadDistancesError"
```
```yaml
    RoadDistancesErrorCode:
      type: string
      description: Closed set of road-distance failure codes (spec §8). The TS union in services/orsClient.ts mirrors it.
      enum: [road_distances_unavailable, road_distances_quota, road_distances_failed, road_distances_unroutable]
    RoadDistancesError:
      type: object
      required: [error, message]
      properties:
        error:
          $ref: "#/components/schemas/RoadDistancesErrorCode"
        message:
          type: string
```
  Run `pnpm --filter @workspace/api-spec run codegen` (same TS2308 handling as Task 3). Add one assertion to `orsClient.test.ts` pinning the union to the spec enum:

```ts
import { readFileSync } from "node:fs";
import { ROAD_ERROR_STATUS } from "../services/orsClient.js";
it("the TS error-code union equals the OpenAPI enum", () => {
  const yaml = readFileSync(new URL("../../../../lib/api-spec/openapi.yaml", import.meta.url), "utf8");
  const m = /RoadDistancesErrorCode:[\s\S]*?enum: \[([^\]]+)\]/.exec(yaml)!;
  expect(m[1].split(",").map(s => s.trim()).sort()).toEqual(Object.keys(ROAD_ERROR_STATUS).sort());
});
```

- [ ] **Step 7: Run** both files and `src/__tests__/lockedModelGuards.test.ts` (PASS), then `pnpm gate`. Optional live smoke (only if the user has supplied a key; never commit it): `ORS_API_KEY=<key> pnpm --filter api-server run dev`, import the sample with `distanceMethod: "road"`, POST the route once, record request count and elapsed time in the changelog. Otherwise record "live ORS check pending the user's key" (spec §9 phase 3).

- [ ] **Step 8: Commit** on `sm2-9-work`:
```bash
[ "$(git rev-parse --abbrev-ref HEAD)" != "main" ] || { echo "ON MAIN — commit refused"; exit 1; }
git add artifacts/api-server/src/services/orsClient.ts artifacts/api-server/src/__tests__/orsClient.test.ts artifacts/api-server/src/__tests__/superRoadRoute.test.ts lib/api-zod/src/generated lib/api-client-react/src/generated
git commit artifacts/api-server/src/services/orsClient.ts artifacts/api-server/src/routes/superNetwork.ts artifacts/api-server/src/__tests__/orsClient.test.ts artifacts/api-server/src/__tests__/superRoadRoute.test.ts lib/api-spec/openapi.yaml lib/api-zod lib/api-client-react/src/generated docs/CHANGELOG-implementation.md -m "[SM2-9] fetch OpenRouteService road distances through an owner-scoped route"
```

---
### Task 10 [SM2-10]: Studio — road method, fetch dialog with privacy notice, readiness action

Role: frontend-engineer.

**Files:**
- Create: `artifacts/studio/src/components/workspace/super/SuperRoadDistancesDialog.tsx`
- Modify: `artifacts/studio/src/components/workspace/super/SuperDistancesTab.tsx:5-29`
- Modify: `artifacts/studio/src/components/workspace/super/SuperReadinessPanel.tsx` (road action)
- Modify: `artifacts/studio/src/pages/Workspace.tsx:2109-2112` (`buildWholeInputPayload`), `:3828-3840` (distances tab), `:4609-4612` (readiness), `:4710-4717` (dialog mount)
- Create: `artifacts/studio/src/__tests__/SuperRoadDistancesDialog.test.tsx`
- Modify: `artifacts/studio/src/__tests__/SuperDistancesTab.test.tsx`, `artifacts/studio/src/__tests__/SuperReadinessPanel.test.tsx`, `artifacts/studio/src/__tests__/Workspace.Super.test.tsx`

**Interfaces:**
- Consumes: generated `useFetchScenarioRoadDistances` (variables `{ scenarioId }`), `RoadDistancesErrorCode` const (Task 9); `describeWriteError`; `handleImportApplied`.
- Produces: `SuperRoadDistancesDialog` props `{ open: boolean; onOpenChange(o: boolean): void; scenarioId: number; onApplied(s: Scenario): void }`; `export function describeRoadError(err: unknown): string`. `SuperDistancesTab` props gain `distanceMethod: "haversine" | "circuity" | "road"`, `onFetchRoad(): void`, `fetchDisabledReason: string | null`. `SuperReadinessPanel` props gain `onFetchRoad?: () => void` (rendered when set). Test ids: `super-road-dialog`, `super-road-privacy`, `super-road-confirm`, `super-road-error`, `super-road-fetch` (Distances tab), `super-readiness-fetch-road`.
- Rule: the fetch action is disabled while the draft is dirty (`saveEnabled`), titled "Save your changes first" — the route reads the saved row, and resyncing with `handleImportApplied` then cannot discard unsaved edits (open issue 8).

- [ ] **Step 1: Failing tests.** `src/__tests__/SuperRoadDistancesDialog.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

const { mutate, state } = vi.hoisted(() => ({ mutate: vi.fn(), state: { isError: false, error: null as unknown, isPending: false } }));
vi.mock("@workspace/api-client-react", () => ({
  useFetchScenarioRoadDistances: () => ({ mutate, reset: vi.fn(), ...state }),
  RoadDistancesErrorCode: { road_distances_unavailable: "road_distances_unavailable", road_distances_quota: "road_distances_quota",
    road_distances_failed: "road_distances_failed", road_distances_unroutable: "road_distances_unroutable" },
}));
vi.mock("@/hooks/use-toast", () => ({ toast: vi.fn() }));
import { SuperRoadDistancesDialog, describeRoadError } from "@/components/workspace/super/SuperRoadDistancesDialog";

beforeEach(() => { mutate.mockReset(); Object.assign(state, { isError: false, error: null, isPending: false }); });
const open = (onApplied = vi.fn()) => render(<SuperRoadDistancesDialog open onOpenChange={vi.fn()} scenarioId={7} onApplied={onApplied} />);

describe("SuperRoadDistancesDialog", () => {
  it("states every time that coordinates are sent to OpenRouteService", () => {
    open();
    expect(screen.getByTestId("super-road-privacy")).toHaveTextContent("plant, warehouse and customer coordinates");
    expect(screen.getByTestId("super-road-privacy")).toHaveTextContent("OpenRouteService");
  });
  it("confirm posts once for the scenario and hands the scenario back", () => {
    const onApplied = vi.fn();
    mutate.mockImplementation((_v, o) => o.onSuccess({ scenario: { id: 7 } }));
    open(onApplied);
    fireEvent.click(screen.getByTestId("super-road-confirm"));
    expect(mutate.mock.calls[0][0]).toEqual({ scenarioId: 7 });
    expect(onApplied).toHaveBeenCalledWith({ id: 7 });
  });
  it.each([
    ["road_distances_quota", "OpenRouteService quota reached, try again later. The daily quota is shared by everyone using this server."],
    ["road_distances_unroutable", "No road route from P1 to W1. Add a distance override for that pair."],
    ["road_distances_unavailable", "Road distances are not available: no OpenRouteService key is configured on this server."],
    ["road_distances_failed", "OpenRouteService failed for warehouses → customers 41–110 (HTTP 500)."],
  ])("shows the server message for %s", (code, message) => {
    Object.assign(state, { isError: true, error: { status: 429, data: { error: code, message } } });
    open();
    expect(screen.getByTestId("super-road-error")).toHaveTextContent(message);
  });
  it("an unknown body falls back to the generic write-error text", () => {
    expect(describeRoadError({ status: 500, data: { error: "Internal server error" } })).toBe("Internal server error");
  });
});
```

  `SuperDistancesTab.test.tsx` gains: the select has a `road` option; with `distanceMethod="road"`, `super-road-fetch` renders, calls `onFetchRoad`, and is disabled with title "Save your changes first" when `fetchDisabledReason` is that string; with `haversine`, no `super-road-fetch`. `SuperReadinessPanel.test.tsx`: `onFetchRoad` set ⇒ `super-readiness-fetch-road` renders and calls it. `Workspace.Super.test.tsx`:

```tsx
  it("SM2-10: Save never sends roadDistances (server-written; at the caps it would exceed the body limit)", () => {
    const withRoad = { ...scenario, inputs: { ...sample, distanceMethod: "road", roadDistances: { fetchedAt: "2026-10-23T00:00:00.000Z", profile: "driving-hgv", coords: {}, pairs: [] } } };
    mockUseGetScenario.mockReturnValue({ data: withRoad } as unknown as ReturnType<typeof mockUseGetScenario>);
    mockUseListScenarios.mockReturnValue({ data: [withRoad] } as unknown as ReturnType<typeof mockUseListScenarios>);
    renderWorkspace();
    fireEvent.click(screen.getByTestId("sidebar-input-products"));
    fireEvent.change(screen.getByTestId("super-products-product-1-name"), { target: { value: "Renamed" } });
    fireEvent.click(screen.getByTestId("button-save"));
    const sent = mockUpdateScenario.mutate.mock.calls[0][0].data.inputs;
    expect(sent).not.toHaveProperty("roadDistances");
    expect(sent.distanceMethod).toBe("road");
  });
  it("SM2-10: method road shows the fetch action; it is disabled while unsaved", () => {
    const road = { ...scenario, inputs: { ...sample, distanceMethod: "road" } };
    mockUseGetScenario.mockReturnValue({ data: road } as unknown as ReturnType<typeof mockUseGetScenario>);
    mockUseListScenarios.mockReturnValue({ data: [road] } as unknown as ReturnType<typeof mockUseListScenarios>);
    renderWorkspace();
    fireEvent.click(screen.getByTestId("sidebar-input-distances"));
    expect(screen.getByTestId("super-road-fetch")).not.toBeDisabled();
    fireEvent.change(screen.getByTestId("super-circuity-factor"), { target: { value: "1.5" } });
    fireEvent.click(screen.getByTestId("sidebar-input-products"));
    fireEvent.change(screen.getByTestId("super-products-product-1-name"), { target: { value: "X" } });
    fireEvent.click(screen.getByTestId("sidebar-input-distances"));
    expect(screen.getByTestId("super-road-fetch")).toBeDisabled();
  });
```

  Match the Save mock's call shape to the existing "Optimization Parameters … Save sends no distanceBands" test in the same file (`:153-166`), which already reads the sent inputs; copy its accessor. Add `useFetchScenarioRoadDistances: vi.fn(() => ({ mutate: vi.fn(), reset: vi.fn(), isPending: false, isError: false }))` and the `RoadDistancesErrorCode` const to that file's `vi.mock("@workspace/api-client-react", …)`.

- [ ] **Step 2: Run, expect FAIL:** `pnpm --filter studio exec vitest run src/__tests__/SuperRoadDistancesDialog.test.tsx src/__tests__/SuperDistancesTab.test.tsx src/__tests__/SuperReadinessPanel.test.tsx src/__tests__/Workspace.Super.test.tsx`

- [ ] **Step 3: Dialog** (`SuperRoadDistancesDialog.tsx`):

```tsx
import { useFetchScenarioRoadDistances, RoadDistancesErrorCode } from "@workspace/api-client-react";
import type { Scenario } from "@workspace/api-client-react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";
import { describeWriteError } from "@/lib/describeWriteError";

const CODES = new Set<string>(Object.values(RoadDistancesErrorCode));
/** A road error carries its own sentence (`message`); `error` is a closed code (spec §8), never shown raw. */
export function describeRoadError(err: unknown): string {
  const data = (err as { data?: { error?: unknown; message?: unknown } } | null)?.data;
  if (data && typeof data.error === "string" && CODES.has(data.error) && typeof data.message === "string") return data.message;
  return describeWriteError(err, "Could not fetch road distances.");
}

export interface SuperRoadDistancesDialogProps { open: boolean; onOpenChange(o: boolean): void; scenarioId: number; onApplied(s: Scenario): void }

export function SuperRoadDistancesDialog({ open, onOpenChange, scenarioId, onApplied }: SuperRoadDistancesDialogProps) {
  const fetchRoad = useFetchScenarioRoadDistances();
  const close = (o: boolean) => { if (!o) fetchRoad.reset(); onOpenChange(o); };
  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent data-testid="super-road-dialog" className="sm:max-w-lg">
        <DialogHeader><DialogTitle>Fetch road distances</DialogTitle></DialogHeader>
        <div className="space-y-2 text-sm">
          <p data-testid="super-road-privacy">
            This sends the plant, warehouse and customer coordinates of this scenario to OpenRouteService (openrouteservice.org),
            which returns truck (driving-hgv) road distances. Names and demand are not sent.
          </p>
          <p className="text-xs text-muted-foreground">It can take up to two minutes. Distance overrides still win over road distances.</p>
          {fetchRoad.isError && <p className="text-xs text-destructive" data-testid="super-road-error">{describeRoadError(fetchRoad.error)}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => close(false)}>Cancel</Button>
          <Button size="sm" disabled={fetchRoad.isPending} data-testid="super-road-confirm"
            onClick={() => fetchRoad.mutate({ scenarioId }, {
              onSuccess: ({ scenario }) => { toast({ title: "Road distances fetched" }); onApplied(scenario); close(false); },
            })}>
            {fetchRoad.isPending ? "Fetching…" : "Send and fetch"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

  The request body sends ids? No — the server reads coordinates from the saved row; the notice is still accurate (the server forwards coordinates only; `planBatches` sends `[lng, lat]` and no names).

- [ ] **Step 4: Distances tab** (`SuperDistancesTab.tsx`): props type `distanceMethod: "haversine" | "circuity" | "road"; onFetchRoad(): void; fetchDisabledReason: string | null;`; add `<option value="road">Road (OpenRouteService, truck)</option>`; after the circuity input:

```tsx
        {p.distanceMethod === "road" && (
          <Button size="sm" variant="outline" data-testid="super-road-fetch" onClick={p.onFetchRoad}
            disabled={p.readOnly || p.fetchDisabledReason !== null} title={p.fetchDisabledReason ?? undefined}>
            Fetch road distances
          </Button>
        )}
```
  and the help text: `Pairs without an override use the method above. Overrides always win. Road pairs are checked by the readiness panel.` (`import { Button } from "@/components/ui/button";`).

  Readiness panel: after the error list,
```tsx
      {onFetchRoad && (
        <Button size="sm" variant="outline" className="mt-2" onClick={onFetchRoad} data-testid="super-readiness-fetch-road">Fetch road distances</Button>
      )}
```

- [ ] **Step 5: Workspace.**
  - `buildWholeInputPayload` (`:2109-2112`):
```tsx
    // Super Model has no distance bands (spec §6), and roadDistances is server-written (§8): never send either.
    if (modelId === "super-model") { const { roadDistances: _server, ...rest } = localInputs ?? {}; return rest; }
    return { ...(localInputs ?? {}), distanceBands: activeBandLens };
```
  - `const [superRoadOpen, setSuperRoadOpen] = useState(false);` and `const superFetchDisabledReason = saveEnabled ? "Save your changes first" : null;` next to `superImportOpen` (after `saveEnabled` is defined at `:2250`; place the derived value after that line).
  - Distances tab (`:3829`): `distanceMethod={localInputs.distanceMethod === "circuity" || localInputs.distanceMethod === "road" ? localInputs.distanceMethod : "haversine"}`, `onFetchRoad={() => setSuperRoadOpen(true)}`, `fetchDisabledReason={superFetchDisabledReason}`.
  - Readiness (`:4611`): `onFetchRoad={currentScenario?.inputs && (currentScenario.inputs as Record<string, unknown>).distanceMethod === "road" && !superFetchDisabledReason ? () => setSuperRoadOpen(true) : undefined}` (reads saved state, like readiness itself).
  - Mount once beside `SuperNetworkImportDialog` (`:4710`):
```tsx
      {modelId === "super-model" && currentScenario && (
        <SuperRoadDistancesDialog open={superRoadOpen} onOpenChange={setSuperRoadOpen} scenarioId={currentScenario.id} onApplied={handleImportApplied} />
      )}
```
    `handleImportApplied` resyncs `localInputs`/`savedInputsRef` and invalidates the scenario, list and precheck queries (`:2274-2281`), so readiness refreshes.

- [ ] **Step 6: Run** the four files (PASS) and `pnpm gate`.

- [ ] **Step 7: Commit** on `sm2-10-work`:
```bash
[ "$(git rev-parse --abbrev-ref HEAD)" != "main" ] || { echo "ON MAIN — commit refused"; exit 1; }
git add artifacts/studio/src/components/workspace/super/SuperRoadDistancesDialog.tsx artifacts/studio/src/__tests__/SuperRoadDistancesDialog.test.tsx
git commit artifacts/studio/src/components/workspace/super/SuperRoadDistancesDialog.tsx artifacts/studio/src/components/workspace/super/SuperDistancesTab.tsx artifacts/studio/src/components/workspace/super/SuperReadinessPanel.tsx artifacts/studio/src/pages/Workspace.tsx artifacts/studio/src/__tests__/SuperRoadDistancesDialog.test.tsx artifacts/studio/src/__tests__/SuperDistancesTab.test.tsx artifacts/studio/src/__tests__/SuperReadinessPanel.test.tsx artifacts/studio/src/__tests__/Workspace.Super.test.tsx docs/CHANGELOG-implementation.md -m "[SM2-10] select road distances in the studio and fetch them behind a privacy notice"
```

---

### Task 11 [SM2-11]: Real-browser QA (Playwright) and sibling-spec sweep

Role: qa-sdet (exempt from the simplicity skills; if a ponytail ruleset is injected, ignore it and say so). Review: a separate `fable`-model reviewer (AGENTS.md).

**Files:**
- Modify: `artifacts/studio/e2e/super-model.spec.ts`
- Modify: any sibling `artifacts/studio/e2e/*.spec.ts` the Step 3 grep finds
- Modify: `docs/superpowers/flake-registry.md` (only for new sightings)

- [ ] **Step 1: Tests D–F** in `super-model.spec.ts` (same helpers; fresh user; `try/finally` delete):
  - **D — CSV set → Input Map → edit on map → save.**
    1. Create via UI (empty state). Click `super-download-sample-csv`; `const dl = await page.waitForEvent("download")` (start the wait before the click); read it with `fs.readFileSync(await dl.path())`; `unzipSync` (from `fflate`) → eight entries.
    2. Open import (`super-open-import`), `super-import-mode-replace`, `page.setInputFiles("[data-testid=super-import-file]", Object.entries(files).map(([name, u]) => ({ name, mimeType: "text/csv", buffer: Buffer.from(u) })))`, confirm.
    3. `super-map-toolbar` visible; `[data-testid="input-map-tab"] .leaflet-marker-icon.pl-marker` count 4, `.wh-marker` 25, `.cs-marker` 100 (from the sample).
    4. Server: `GET /api/scenarios/:id` inputs equal the JSON sample (`expect(saved.inputs).toMatchObject(sample)` on every table; the CSV round-trip is identical).
    5. Right-click the first `.pl-marker` → `map-action-edit` → `super-entity-name` = `"Edited on map"` → `super-entity-submit` → `button-save` → poll the server until `inputs.plants[0].name === "Edited on map"`.
  - **E — XLSX workbook.** Same as D with `super-download-sample-xlsx` and one buffer `{ name: "super-model-sample.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer }`; assert pins and server equality; then on the map right-click a `.cs-marker` → `map-action-copy` → `button-save` → server has 101 customers, the new one named `<original> (copy)` with id `C-1`.
  - **F — CSV error mapping.** Import a single `plants.csv` buffer containing `id,name,lat,lng\nA,P,north,2\n` → `super-import-file-error` contains `plants.csv row 2 column lat: is not a number`; nothing posted (server inputs unchanged).
  - Road distances get no Playwright test (no ORS in e2e; spec §8 "tests never call ORS"); their browser surface is covered by RTL (Task 10).

- [ ] **Step 2: Run.** Start both servers per `artifacts/studio/e2e/CLAUDE.md`; `E2E_BASE_URL=http://localhost:<studio-port> pnpm --filter studio exec playwright test e2e/super-model.spec.ts` — A–F PASS. **Never omit `E2E_BASE_URL`.**

- [ ] **Step 3: Sibling sweep.** For every testid / visible string this bundle changed or removed, grep `artifacts/studio/e2e/`: `Export network (JSON)`, `super-header-export`, `super-import-file`, `super-download-template`, `super-download-sample`, `super-empty-state`, `sidebar-input-products` (super), `input-map-tab`, `toggle-layer-plants`, `map-add-menu`, `Fetch road distances`, plus `jade-map-toolbar` / `pmedian-map-toolbar` (the control move in Task 1 must not have changed them). Run `E2E_BASE_URL=… pnpm e2e:gate`; rewrite any broken sibling spec to the new UI, re-run until green; register new flakes by name with two isolated re-runs.

- [ ] **Step 4: Journey + accuracy.** `cd artifacts/api-server/src/solver/tests && python3 e2e_journey.py http://localhost:<api-port> super` (all checks pass; unchanged file) and `python3 e2e_accuracy.py` (99/99).

- [ ] **Step 5: Commit** on `sm2-11-work`:
```bash
[ "$(git rev-parse --abbrev-ref HEAD)" != "main" ] || { echo "ON MAIN — commit refused"; exit 1; }
git commit artifacts/studio/e2e docs/superpowers/flake-registry.md docs/CHANGELOG-implementation.md -m "[SM2-11] cover super-model CSV, XLSX and Input Map editing in a real browser"
```

---

### Task 12 [SM2-12]: Close-out

Role: lead.

- [ ] Integrated-branch gate on `super-model-2`, zero concurrent vitest: `pnpm gate`, `e2e_accuracy.py` 99/99, `e2e_journey.py … super`, `E2E_BASE_URL=… pnpm e2e:gate`.
- [ ] `docs/CHANGELOG-implementation.md`: one entry per task with SHA, gate counts, and the measured facts — Task 3 byte count, Task 4 dependency choice + audit before/after, Task 6 Render timeout quote and ORS checks, Task 9 live check status. Close-out entry lists deferred items: live ORS check once the user supplies `ORS_API_KEY`; open issues not resolved by the user.
- [ ] Spec fold (same commit; one canonical copy, edit in place): §7.1 issue paths are document-relative and the Studio uses a row map; §6.1 Super map uses the toolbar Save; §8 HTTP statuses 503/429/502/422 and the readiness item reuses `completeness`; §7.2 the CSV/XLSX template and sample are generated in the browser from the JSON files; the chosen XLSX/zip libraries.
- [ ] Memory pointer: update `~/.claude/projects/-Users-shubhamkr-network-optimization-studio/memory/project_super_model_phases.md` — Phase 2 + Input Map + Phase 3 implemented on `super-model-2` (not merged / deployed), plan path, `ORS_API_KEY` still to be supplied.
- [ ] Run `/harness-retro SM2`.
- [ ] Invoke `superpowers:finishing-a-development-branch`, then **STOP and ask the user for merge approval**. Merge, whole-branch review, push and deploy are four separate approvals; never merge, push or deploy from this task.
- [ ] Deploy note for the later approval request: `pnpm deploy:preflight -- <deployed-sha>..HEAD`; no `lib/db/src/schema/**` change; **new env var `ORS_API_KEY`** (`sync: false`, Dashboard) on `nos-api`; `SOLVER_CODE_HASH` changes again (`merge_inputs.py`), so cached results miss once; nos-studio and nos-api must ship together (the Studio calls the new route and reads `issues`).
- [ ] Commit on `sm2-12-closeout`: `git commit docs/CHANGELOG-implementation.md docs/superpowers/specs/2026-10-23-super-model-design.md -m "[SM2-12] close out super-model phases 2-3"` (with the not-on-main guard).

---

## Spec deviations / open issues

Recorded, not silently picked. Items marked **ASK** need a user decision before or during execution; the plan's default is stated.

1. **Row numbers when empty rows are skipped.** §7.1's `row = path[1] + 2` is wrong after a skipped fully-empty row (§7.2). The Studio keeps a per-table row map (`Source.rows`), equal to `path[1] + 2` whenever nothing was skipped.
2. **Merge-mode issue paths.** Whole-network validation runs on the merged tables, so `path[1]` would index the merged array, not the file. The server rewrites paths to document rows (`toDocIssues`); an issue on a kept existing row becomes `[table]` + "Existing <table> row n:". (Task 3.)
3. **ASK — merge collapses duplicate keys inside one imported table.** `mergeNetwork` (Phase 1) keeps the last of two rows with the same id/pair key instead of rejecting them, contrary to §3.3/§7.3 uniqueness. Not fixed by this plan; fix would be a duplicate check on the document before merging (Task 3 scope).
4. **ASK — `MoveConfirmDialog` reused as-is shows a misleading "New code" / nearest city.** Super writes lat/lng only (§6.1), so the shown code and city are not applied. Default: reuse as-is per spec.
5. **Copy near the antimeridian.** `lng + 0.05` is clamped to 180 (schema max).
6. **Dependency count.** §7.2 says one new Studio dependency + one zip library. SheetJS meets that; read-/write-excel-file would be two. `pnpm audit` does not cover a tarball-URL dependency (SheetJS CDN). papaparse is added to the studio manifest (already in the lockfile).
7. **ASK — HTTP statuses for road errors** (spec gives only 503 for unavailable): quota 429, failed 502, unroutable 422.
8. **Road fetch while unsaved.** Not in the spec: the fetch action is disabled while the draft is dirty, so the post-fetch resync cannot discard edits.
9. **Studio PATCH must omit `roadDistances`.** Not in §8's checklist: at the caps road pairs (~26,000) plus overrides would push Save past 2 MiB; the server discards a client copy anyway. (Task 10.)
10. **Create path.** §8 names PATCH and import; POST `/scenarios` also drops a client `roadDistances` (every-write-path gotcha); clone keeps the server value.
11. **Export.** `GET /network/export` must strip `roadDistances` once the persisted schema carries it (§7.2 "JSON … without roadDistances").
12. **Empty scenario on the Input Map.** Today's readiness panel would replace the map for an empty draft; the Input Map tab is excluded so §6.1's "no points ⇒ world view" and add-on-map are reachable. CSV/XLSX templates and sample are generated in the browser from the JSON files (no committed binaries).
13. **Road readiness code.** Reuses precheck code `completeness` (no new closed-union precheck code / OpenAPI change).
14. **Max-size measurement scope.** String lengths are unbounded by the schema; Task 3 measures a defined worst case. Pre-plan estimate 1,913,859 B of 2,097,152 (~9% margin).
15. **Two delete confirmations on the map.** `MapActionMenu`'s own "Confirm delete?" step precedes the D3 row-count dialog.
16. **Not verified while planning:** Render's HTTP request timeout (two guessed doc URLs 404'd; the web-services page does not state it) and the ORS `distances`/limits shape (the ORS docs page lacks limits and response shape). Task 6 is the gate.

## Self-review

- **Spec coverage:**

  | Spec | Task(s) |
  |---|---|
  | §6.1 wiring, seeding, switch-to-map | 1 |
  | §6.1 reuse vs new, `SuperEntityDialog` | 1, 2 |
  | §6.1 fit rules | 1 (test: mount, fitKey, one point, none) |
  | §6.1 add / edit / move / copy / delete, layer toggles | 1 (layers), 2 |
  | §6.1 save / readiness / stale read saved state | 2 (toolbar Save; no map-only write) |
  | §6.1 registration delta, `TabCoverage`, e2e SM-13 | 1, registration map |
  | §7.1 D6 browser parsing, one JSON contract | 4, 5 |
  | §7.1 422 `issues`, OpenAPI + regen same task | 3 |
  | §7.2 formats, names, cell rules, parameters, formula guard | 4 |
  | §7.2 dependency choice after version + audit check, dynamic `import()` | 4 |
  | §7.2 limits, `MAX_IMPORT_BYTES` measured | 3 (server), 5 (client check) |
  | §7.3 replace/merge semantics, `roadDistances` clear/keep | 3, 7 |
  | §6 Phase 2 CSV/XLSX template + sample downloads | 5 |
  | §8 contract checklist (method, persisted schema, doc schema, PATCH preservation, precheck, payload, merge_inputs, route + regen, Studio, error codes, test inversion) | 7, 8, 9, 10 |
  | §8 ORS request, batching, timeouts, queue, failures write nothing | 9 |
  | §8 Render timeout + ORS re-check before choosing | 6 |
  | §8 D8 validity, required pairs | 8 |
  | §8 key / privacy / injected fetch / `render.yaml` | 6, 9, 10 |
  | §10 API tests (issues, road route list) | 3, 7, 8, 9 |
  | §10 Studio unit (parity, re-parse, issues, parameters, coercion, formula round-trip, real writer) | 4 |
  | §10 RTL (Input Map actions, switch-to-map, road dialog) | 1, 2, 10 |
  | §10 Playwright Phase 2 + sibling sweep | 11 |

- **Placeholder scan:** no TBD/TODO. Task 6's "Findings" block is filled by that task by design (it records measurements). Task 3 Step 7 and Task 4 Step 1 are conditional on measured outcomes; both give the exact code or the exact stop.
- **Type consistency:** `SuperInputsLike`, `LocKind`, `LOC_TABLE`, `LocationDraft` (Tasks 1–2); `InputIssue` / `toInputIssues` / `MergeOrigin` / `toDocIssues` (Tasks 3, 7, 9); `Sources` / `describeIssue` (Tasks 4, 5); `RoadDistances` / `RoadDistancesWrite` / `dropClientOwnedInputs` (Tasks 7, 9); `RoadPair` / `validRoadPairs` / `missingRequiredRoadPairs` (Tasks 8, 9); `RoadDistancesErrorCode` / `ROAD_ERROR_STATUS` / `fetchScenarioRoadDistances` (Tasks 9, 10). The final `mode: "super"` props (Task 2) widen Task 1's; Task 2 Step 2 updates Task 1's render calls.
- **Fixes made during self-review:** removed a dead `points.length` guard from `takenIds`; replaced JSON-substring assertions on parse errors with exact `where: message` lists; replaced an ESM-namespace `vi.spyOn` with `vi.mock`; replaced a raw-SQL test seed with a Drizzle update; replaced a precheck test that depended on unstated sample facts with one using the computed 2,600 required pairs; typed `pairs` in the route and dropped a no-op `toDocIssues(…, {})`.
- **Known reads the implementer must do (exact files named):** the existing mock shape in `SuperNetworkImportDialog.test.tsx` and the Save-call accessor in `Workspace.Super.test.tsx:153-166`; `MapActionMenu.tsx` test ids; Orval's generated names after each codegen.

## Plan review log

Not yet reviewed. Before execution, run an independent plan review (Codex high, read-only, as for Phase 1) and fold its findings into this file, recording each finding and its resolution here.
