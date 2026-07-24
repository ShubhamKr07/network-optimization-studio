# Studio Map Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix three real bugs in the Studio map view — the map being visually cut off at the bottom of the viewport, route lines never rendering for the transport-coal (coal LP) lab after a solve, and customer/station markers having no hover tooltip (only warehouses do) — without regressing any other page's scroll behavior.

**Architecture:** All three bugs trace back to two root causes found via live investigation (a real browser session against the deployed app, plus reading the exact rendering code): (1) `AppShell.tsx`'s root container uses `min-h-screen` instead of `h-screen`, so the fixed-viewport/`overflow-hidden` layout every page below it assumes never actually gets a real viewport-height anchor — content just grows past the fold and the whole document scrolls, cutting off the map's visible bottom edge; (2) `GET /api/dataset` is hardcoded to always return the p-median-us dataset (26 warehouses, 200 customers) regardless of which model/lab is active, so `NetworkMap.tsx`'s edge-to-coordinate lookups (`dataset.customers.find(c => c.id === edge.toId)`) can never resolve transport-coal's mine/station ids (`KY`, `CHI`, ...) — routes silently fail to render because the customer/warehouse lookup always returns nothing for that model. Fix (1) first since it's a one-line change with no dependencies. Fix (2) by making `/api/dataset` model-scoped (reusing the already-existing `@workspace/dataset-schema` package's `validatePackage()`/`PACKAGE_SPECS` to read `mines.json`/`stations.json` for transport-coal), then wire `Studio.tsx` to request the dataset for its active model. Once that's in place, the customer/station hover-tooltip addition (3) is a small, self-contained addition to `NetworkMap.tsx` that benefits both models for free, since they share one map component.

**Tech Stack:** React 18, Vite, Tailwind, react-leaflet (Leaflet 1.x), Express 5, Zod, Orval codegen (`lib/api-spec/openapi.yaml` → `lib/api-zod`/`lib/api-client-react`), Vitest + React Testing Library, Supertest.

## Global Constraints

- Never hand-edit anything under `lib/api-zod/src/generated/` or `lib/api-client-react/src/generated/` — those are Orval codegen output. Any API shape change starts in `lib/api-spec/openapi.yaml`, then `pnpm --filter @workspace/api-spec run generate` (or the project's equivalent Orval command — confirm the exact script name in `lib/api-spec/package.json` before running), then commit the spec + regenerated output together.
- `p-median-brazil` (the `BrazilMap.tsx` lab) is explicitly out of scope for every task in this plan — it does not use `useGetDataset()` at all (confirmed: only `NetworkMap.tsx` and `Studio.tsx` reference the hook or `dataset.warehouses`/`dataset.customers` anywhere in `artifacts/studio/src`), so none of these changes touch it.
- Full verification gate before considering any task done: `pnpm run typecheck && pnpm --filter api-server test && pnpm --filter studio test` (no Python/solver changes in this plan, so `pytest`/`e2e_accuracy.py` do not need re-running unless a task explicitly says otherwise).
- One task = one commit, message format `fix: <imperative summary>` (matches this repo's existing convention for unplanned bug-fix work outside `IMPLEMENTATION_PLAN.md`'s task-ID scheme).

---

### Task 1: Fix the viewport-height chain so the map is never cut off

**Files:**
- Modify: `artifacts/studio/src/components/AppShell.tsx:33,42`
- Test: `artifacts/studio/src/__tests__/AppShell.test.tsx`

**Interfaces:**
- Consumes: nothing from other tasks — fully independent, can land first.
- Produces: nothing new; this only fixes the root layout chain that `Studio.tsx` (`artifacts/studio/src/pages/Studio.tsx:573,721,1039,1040,1094`), `Landing.tsx`, and `Compare.tsx` already assume is correct.

**Root cause (verified by reading every layer of the chain):** `AppShell.tsx:33` is `<div className="min-h-screen flex flex-col">`. `min-h-screen` sets only a *minimum* height (100vh) — it does not clamp the container to exactly one viewport. Every page rendered inside it (`Studio.tsx:573` is `<div className="studio-lab flex flex-col h-full overflow-hidden bg-background">`, using `h-full` + `overflow-hidden`, expecting its own height to be a hard, definite 100%-of-parent) assumes it is inside a container whose height is *fixed* to the viewport, not just a floor. Because the real ancestor only guarantees a *minimum*, when Studio's own content is taller than one viewport, the browser lets the whole `AppShell` grow past 100vh instead of clamping — so Studio's internal `flex-1`/`min-h-0` chain (which is otherwise completely correct, verified by reading `NetworkMap.tsx:260-267` and `Studio.tsx:1039-1094`) computes against an oversized, auto-height ancestor instead of the true viewport, and the whole document becomes scrollable with the map's bottom portion rendered below the fold. `Landing.tsx` and `Compare.tsx` currently rely on exactly this same page-level scroll (neither has its own internal `overflow-y-auto` container — confirmed by reading both files' root JSX), so simply clamping `AppShell` to `h-screen` without giving `<main>` its own scroll container would clip Landing/Compare's content instead of letting it scroll.

**Current code (`artifacts/studio/src/components/AppShell.tsx:32-44`):**
```tsx
  return (
    <div className="min-h-screen flex flex-col">
      <header className="h-12 border-b flex items-center px-4 gap-3 flex-shrink-0 bg-background">
        <span className="font-semibold text-sm">Network Optimization Studio</span>
        <div className="flex-1" />
        <span className="text-sm text-muted-foreground" data-testid="text-user-email">{userEmail}</span>
        <Button variant="ghost" size="sm" onClick={handleLogout} data-testid="button-logout">
          Log out
        </Button>
      </header>
      <main className="flex-1 min-h-0">{children}</main>
    </div>
  );
```

- [ ] **Step 1: Write the failing test**

Add to `artifacts/studio/src/__tests__/AppShell.test.tsx` (append to the existing `describe("AppShell logout", ...)` file — add a new top-level `describe` block below it):

```tsx
describe("AppShell layout", () => {
  it("clamps its root to exactly one viewport height and scopes scrolling to <main>", () => {
    render(
      <AppShell userEmail="student@example.com">
        <div>lab content</div>
      </AppShell>,
    );
    const root = screen.getByTestId("text-user-email").closest("div.flex.flex-col") as HTMLElement;
    // Walk up to the true root (the outermost div AppShell renders).
    const outerRoot = root?.parentElement?.parentElement as HTMLElement;
    expect(outerRoot.className).toContain("h-screen");
    expect(outerRoot.className).not.toContain("min-h-screen");
    expect(outerRoot.className).toContain("overflow-hidden");
    const main = screen.getByText("lab content").closest("main") as HTMLElement;
    expect(main.className).toContain("overflow-y-auto");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter studio test -- AppShell`
Expected: FAIL — `outerRoot.className` contains `"min-h-screen"` not `"h-screen"`, and `main.className` does not contain `"overflow-y-auto"`.

- [ ] **Step 3: Apply the fix**

Replace `artifacts/studio/src/components/AppShell.tsx:33` and `:42`:

```tsx
  return (
    <div className="h-screen flex flex-col overflow-hidden">
      <header className="h-12 border-b flex items-center px-4 gap-3 flex-shrink-0 bg-background">
        <span className="font-semibold text-sm">Network Optimization Studio</span>
        <div className="flex-1" />
        <span className="text-sm text-muted-foreground" data-testid="text-user-email">{userEmail}</span>
        <Button variant="ghost" size="sm" onClick={handleLogout} data-testid="button-logout">
          Log out
        </Button>
      </header>
      <main className="flex-1 min-h-0 overflow-y-auto">{children}</main>
    </div>
  );
```

(Only the two `className` strings change — `min-h-screen` → `h-screen overflow-hidden` on the root, and `overflow-y-auto` added to `<main>`. Nothing else in this file changes.)

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter studio test -- AppShell`
Expected: PASS (both the new test and the existing `"AppShell logout"` tests, unaffected by this change).

- [ ] **Step 5: Manually verify Landing and Compare still scroll correctly**

This is a layout change with no automated test coverage for Landing/Compare's own scroll behavior (neither file has an existing test asserting on page scroll). Start the local dev stack (`DATABASE_URL=... PORT=3001 pnpm --filter api-server run dev`, then `PORT=5173 BASE_PATH=/ API_PROXY_TARGET=http://localhost:3001 pnpm --filter studio run dev`), log in, and:
- On `/` (Landing): shrink the browser window vertically until the chapter cards would overflow one viewport, confirm the page scrolls (not clipped) and the header stays pinned at the top.
- On `/compare`: same check with 2+ scenarios selected so the diff table is tall.
- On a chapter route (Studio): confirm the map now visibly fills the remaining space with no cut-off bottom edge, and the left/right panels each scroll independently if their own content overflows (already-existing `overflow-y-auto` on `<aside>` — unaffected by this change, just now actually able to compute a real height to scroll within).

- [ ] **Step 6: Run the full studio test suite to confirm no regressions**

Run: `pnpm --filter studio test`
Expected: all tests pass (same count as before this task, plus the one new test).

- [ ] **Step 7: Commit**

```bash
git add artifacts/studio/src/components/AppShell.tsx artifacts/studio/src/__tests__/AppShell.test.tsx
git commit -m "$(cat <<'EOF'
fix: clamp AppShell to a real viewport height instead of a growable minimum

AppShell.tsx's root used min-h-screen (a floor, not a ceiling), so every
page's own h-full/overflow-hidden layout chain (Studio.tsx especially)
computed against an ancestor that could silently grow past one viewport
instead of a fixed height -- the whole document became scrollable and the
map's bottom portion rendered below the fold. Root now uses h-screen +
overflow-hidden (a real clamp); <main> gains overflow-y-auto so Landing/
Compare (which have no scroll container of their own) keep scrolling
correctly, just scoped to <main> instead of the whole document.
EOF
)"
```

---

### Task 2: Make `GET /api/dataset` model-scoped

**Files:**
- Modify: `lib/api-spec/openapi.yaml` (add `modelId` query param to the `/dataset` operation)
- Modify: `artifacts/api-server/src/data/dataset.ts` (keep as the p-median-us-only loader, unchanged internals)
- Create: `artifacts/api-server/src/data/transportCoalDataset.ts`
- Modify: `artifacts/api-server/src/routes/dataset.ts`
- Test: `artifacts/api-server/src/__tests__/dataset.test.ts` (create if it doesn't already exist — check first)
- Regenerate: `lib/api-zod/src/generated/*`, `lib/api-client-react/src/generated/*` (codegen output, committed alongside the spec change)

**Interfaces:**
- Consumes: `@workspace/dataset-schema`'s `validatePackage(spec: ModelPackageSpec): Record<string, unknown>` and `PACKAGE_SPECS: ModelPackageSpec[]` (already exported from `lib/dataset-schema/src/index.ts:98,66` — `api-server` already depends on this package, confirmed in `artifacts/api-server/package.json:17`).
- Produces: `GET /api/dataset?modelId=p-median-us|transport-coal` (defaults to `p-median-us` when the query param is omitted, matching today's behavior exactly for existing callers). The generated `useGetDataset(params?: { modelId?: string })` hook signature Task 3 depends on.

**Current spec (`lib/api-spec/openapi.yaml:35-47`):**
```yaml
  /dataset:
    get:
      operationId: getDataset
      tags: [dataset]
      summary: Get the fixed dataset
      description: Returns all 26 warehouse candidates and 200 customers
      responses:
        "200":
          description: Dataset
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/Dataset"
```

**Current route (`artifacts/api-server/src/routes/dataset.ts`, full file):**
```ts
import { Router } from "express";
import { WAREHOUSES, CUSTOMERS } from "../data/dataset.js";

const router = Router();

router.get("/dataset", (_req, res) => {
  res.json({ warehouses: WAREHOUSES, customers: CUSTOMERS });
});

export default router;
```

**Transport-coal's dataset shape (verified in `solvers/transport-coal/dataset/mines.json`/`stations.json`, via `@workspace/dataset-schema`'s `MineEntry`/`StationEntry` Zod schemas):** `mines.json` is `{ <mineId>: { id, name, city, state, lat, lng, capacity } }` (4 entries: KY, WY, PA, IA); `stations.json` is `{ <stationId>: { id, city, state, lat, lng, demand } }` (15 entries). Both already carry every field the `WarehouseCandidate`/`Customer` OpenAPI schemas require (`id`/`city`/`state`/`lat`/`lng`, plus `Customer` also requires `demand` — `stations.json` has it).

- [ ] **Step 1: Write the failing test**

First check whether `artifacts/api-server/src/__tests__/dataset.test.ts` already exists — if it does, add to it; if not, create it:

```ts
import { describe, it, expect } from "vitest";
import request from "supertest";
import app from "../app.js";

describe("GET /api/dataset", () => {
  it("defaults to the p-median-us dataset (26 warehouses, 200 customers) when modelId is omitted", async () => {
    const res = await request(app).get("/api/dataset");
    expect(res.status).toBe(200);
    expect(res.body.warehouses).toHaveLength(26);
    expect(res.body.customers).toHaveLength(200);
  });

  it("returns the transport-coal dataset (mines as warehouses, stations as customers) when modelId=transport-coal", async () => {
    const res = await request(app).get("/api/dataset?modelId=transport-coal");
    expect(res.status).toBe(200);
    expect(res.body.warehouses).toHaveLength(4);
    expect(res.body.customers).toHaveLength(15);
    const ky = res.body.warehouses.find((w: { id: string }) => w.id === "KY");
    expect(ky).toMatchObject({ id: "KY", city: "Pikeville", state: "KY", lat: 37.54, lng: -82.75 });
    const chi = res.body.customers.find((c: { id: string }) => c.id === "CHI");
    expect(chi).toMatchObject({ id: "CHI", city: "Chicago", state: "IL", demand: 6000000 });
  });

  it("returns 400 for an unknown modelId", async () => {
    const res = await request(app).get("/api/dataset?modelId=not-a-real-model");
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/shubhamkr/network-optimization-studio && DATABASE_URL="postgresql://shubhamkr@localhost:5432/nos_dev" pnpm --filter api-server test -- dataset`
Expected: FAIL on the second and third tests (`modelId=transport-coal` still returns the 26/200 p-median-us dataset since the route ignores query params entirely today; the invalid-modelId case returns 200, not 400).

- [ ] **Step 3: Add the OpenAPI query param**

Edit `lib/api-spec/openapi.yaml:35-47`:

```yaml
  /dataset:
    get:
      operationId: getDataset
      tags: [dataset]
      summary: Get the dataset for a given model
      description: Returns the warehouse/customer-shaped entities for the requested model (p-median-us's real warehouses/customers, or transport-coal's mines/stations mapped onto the same shape). Defaults to p-median-us.
      parameters:
        - name: modelId
          in: query
          required: false
          schema:
            type: string
            enum: [p-median-us, transport-coal]
            default: p-median-us
      responses:
        "200":
          description: Dataset
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/Dataset"
        "400":
          description: Unknown modelId
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/ErrorEnvelope"
```

(Check `lib/api-spec/openapi.yaml` for the exact existing `$ref` name used for error bodies elsewhere in this file — e.g. search for `ErrorEnvelope` — and use that exact name; it is already used by other endpoints in this spec, no new schema needed.)

- [ ] **Step 4: Regenerate the API client**

Run: `cd /Users/shubhamkr/network-optimization-studio && pnpm --filter @workspace/api-spec run generate` (confirm this is the exact script name by checking `lib/api-spec/package.json`'s `scripts` block first — use whatever the real script is called, e.g. it may be `pnpm --filter @workspace/api-spec run codegen` or similar; do not guess if the name differs from what's written here).
Expected: `lib/api-zod/src/generated/*` and `lib/api-client-react/src/generated/*` update — `useGetDataset` gains an optional `params: { modelId?: "p-median-us" | "transport-coal" }` argument, matching the existing pattern already used by `useListScenarios({ modelId })` (`artifacts/studio/src/pages/Studio.tsx:168`).

- [ ] **Step 5: Create the transport-coal dataset loader**

Create `artifacts/api-server/src/data/transportCoalDataset.ts`:

```ts
import { validatePackage, PACKAGE_SPECS } from "@workspace/dataset-schema";
import type { WarehouseCandidate, Customer } from "./dataset.js";

interface MineEntry { id: string; name: string; city: string; state: string; lat: number; lng: number; capacity: number; }
interface StationEntry { id: string; city: string; state: string; lat: number; lng: number; demand: number; }

const spec = PACKAGE_SPECS.find((s) => s.modelId === "transport-coal")!;
const pkg = validatePackage(spec);
const mines = pkg["mines.json"] as Record<string, MineEntry>;
const stations = pkg["stations.json"] as Record<string, StationEntry>;

// Mines play the "warehouse" role and stations play the "customer" role in
// the shared Dataset shape NetworkMap.tsx already renders — this lets the
// existing map component show transport-coal's real mine/station geometry
// with zero changes to NetworkMap.tsx's own field names.
export const TRANSPORT_COAL_WAREHOUSES: WarehouseCandidate[] = Object.values(mines).map((m) => ({
  id: m.id,
  city: m.city,
  state: m.state,
  lat: m.lat,
  lng: m.lng,
}));

export const TRANSPORT_COAL_CUSTOMERS: Customer[] = Object.values(stations).map((s) => ({
  id: s.id,
  city: s.city,
  state: s.state,
  lat: s.lat,
  lng: s.lng,
  demand: s.demand,
}));
```

- [ ] **Step 6: Update the route to be model-scoped**

Replace `artifacts/api-server/src/routes/dataset.ts` in full:

```ts
import { Router } from "express";
import { WAREHOUSES, CUSTOMERS } from "../data/dataset.js";
import { TRANSPORT_COAL_WAREHOUSES, TRANSPORT_COAL_CUSTOMERS } from "../data/transportCoalDataset.js";

const router = Router();

router.get("/dataset", (req, res) => {
  const modelId = (req.query.modelId as string | undefined) ?? "p-median-us";
  if (modelId === "p-median-us") {
    res.json({ warehouses: WAREHOUSES, customers: CUSTOMERS });
    return;
  }
  if (modelId === "transport-coal") {
    res.json({ warehouses: TRANSPORT_COAL_WAREHOUSES, customers: TRANSPORT_COAL_CUSTOMERS });
    return;
  }
  res.status(400).json({ error: `Unknown modelId: ${modelId}` });
});

export default router;
```

- [ ] **Step 7: Run test to verify it passes**

Run: `cd /Users/shubhamkr/network-optimization-studio && DATABASE_URL="postgresql://shubhamkr@localhost:5432/nos_dev" pnpm --filter api-server test -- dataset`
Expected: PASS (all three tests).

- [ ] **Step 8: Run typecheck and the full api-server suite**

Run: `pnpm run typecheck && DATABASE_URL="postgresql://shubhamkr@localhost:5432/nos_dev" pnpm --filter api-server test`
Expected: clean typecheck, all tests pass (no regressions to any existing `/dataset` caller — the default behavior for an omitted `modelId` is byte-identical to today's response).

- [ ] **Step 9: Commit**

```bash
git add lib/api-spec/openapi.yaml lib/api-zod/src/generated lib/api-client-react/src/generated \
  artifacts/api-server/src/data/transportCoalDataset.ts artifacts/api-server/src/routes/dataset.ts \
  artifacts/api-server/src/__tests__/dataset.test.ts
git commit -m "$(cat <<'EOF'
fix: make GET /api/dataset model-scoped instead of always p-median-us

The endpoint ignored which model/lab was active and always returned the
26-warehouse/200-customer p-median-us dataset -- this is why transport-coal's
map could never resolve its own mine/station coordinates (edge.fromId="KY"/
toId="CHI" have no match in the p-median-us id space at all). New optional
?modelId= query param (default p-median-us, unchanged for existing callers);
transport-coal maps mines.json -> warehouses role and stations.json ->
customers role onto the same Dataset shape NetworkMap.tsx already renders,
via @workspace/dataset-schema's existing validatePackage()/PACKAGE_SPECS
(no new parsing logic). Unknown modelId -> 400.
EOF
)"
```

---

### Task 3: Wire `Studio.tsx` to fetch the active model's dataset — fixes routes not rendering for transport-coal

**Files:**
- Modify: `artifacts/studio/src/pages/Studio.tsx:168`
- Test: `artifacts/studio/src/__tests__/Studio.test.tsx`

**Interfaces:**
- Consumes: Task 2's `useGetDataset(params?: { modelId?: "p-median-us" | "transport-coal" })`.
- Produces: nothing new for later tasks — this is the end of the Issue 4 fix chain. `NetworkMap.tsx` itself needs zero changes (its `dataset.customers.find(c => c.id === edge.toId)`/`dataset.warehouses.find(w => w.id === edge.fromId)` lookups at lines 289-291 already work correctly — they were only ever failing because the `dataset` prop they were given was wrong).

**Current code (`artifacts/studio/src/pages/Studio.tsx:168`):**
```tsx
  const { data: dataset, isLoading: datasetLoading } = useGetDataset();
```

- [ ] **Step 1: Write the failing test**

Add to `artifacts/studio/src/__tests__/Studio.test.tsx` (find the existing mock setup for `useGetDataset` near the top of the file and extend it to accept params, then add a new test in a relevant existing `describe` block or a new one):

```tsx
it("requests the transport-coal dataset (not the default p-median-us one) when the active model is transport-coal", async () => {
  renderStudioForModel("transport-coal"); // use this file's existing helper for rendering Studio with a given modelId; if no such helper exists, render <Studio modelId="transport-coal" /> the same way the file's other transport-coal tests already do
  await waitFor(() => {
    expect(mockUseGetDataset).toHaveBeenCalledWith(expect.objectContaining({ modelId: "transport-coal" }));
  });
});
```

(Match this file's actual existing mocking convention exactly — e.g. if `useGetDataset` is mocked via `vi.mock("@workspace/api-client-react", ...)` with a `mockUseGetDataset` spy already defined near the top of the file for other tests, extend that same spy rather than introducing a new mocking pattern. Read the file's current mock block before writing this step for real.)

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter studio test -- Studio`
Expected: FAIL — `useGetDataset` is currently called with zero arguments.

- [ ] **Step 3: Apply the fix**

Replace `artifacts/studio/src/pages/Studio.tsx:168`:

```tsx
  const { data: dataset, isLoading: datasetLoading } = useGetDataset({ modelId: modelId as "p-median-us" | "transport-coal" | undefined });
```

(`modelId` is the `Studio` component's own existing prop, already destructured earlier in the function per `Studio.tsx`'s signature — `p-median-brazil` scenarios never reach this hook's result anyway since `Studio.tsx:1095` branches to `<BrazilMap>` before `dataset` is used for rendering, so passing `modelId="p-median-brazil"` through here is harmless dead weight, not a new bug — the query would just return the default p-median-us dataset unused. If `modelId` can be `"p-median-brazil"` at the type level here, keep the cast broad enough to typecheck cleanly, e.g. `as "p-median-us" | "transport-coal" | undefined` with `p-median-brazil` simply never producing a matching case server-side and falling through to the p-median-us default, which is fine since it's never rendered for Brazil regardless.)

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter studio test -- Studio`
Expected: PASS.

- [ ] **Step 5: Run the full studio suite**

Run: `pnpm --filter studio test`
Expected: all pass, no regressions (p-median-us's existing tests should be unaffected since `modelId="p-median-us"` produces the same query as before).

- [ ] **Step 6: Manual live verification that routes now render for transport-coal**

Start local dev (same commands as Task 1 Step 5). Open a transport-coal (`/chapter-5/transport`) scenario that has already been solved, confirm "Show routes" is toggled on and colored polylines now actually connect mine triangles to station dots on the map (previously: zero lines despite `showRoutes=true` and a populated `result.edges`).

- [ ] **Step 7: Commit**

```bash
git add artifacts/studio/src/pages/Studio.tsx artifacts/studio/src/__tests__/Studio.test.tsx
git commit -m "$(cat <<'EOF'
fix: fetch the active model's own dataset instead of always p-median-us

Studio.tsx called useGetDataset() with no arguments, always getting back
p-median-us's 26 warehouses/200 customers regardless of which lab was
active. For transport-coal this meant NetworkMap's edge-to-coordinate
lookups (matching edge.fromId/toId against dataset.warehouses/customers)
could never find a match for mine/station ids like "KY"/"CHI" -- so route
polylines silently never rendered even though the solve's edges were
correct. Now passes the active modelId through to the model-scoped
/api/dataset endpoint (previous task).
EOF
)"
```

---

### Task 4: Add hover tooltips to customer/station markers

**Files:**
- Modify: `artifacts/studio/src/components/NetworkMap.tsx:313-351`
- Test: `artifacts/studio/src/__tests__/NetworkMap.test.tsx` (create if it doesn't already exist — check first; if `NetworkMap.tsx` has no dedicated test file today, this is the first one)

**Interfaces:**
- Consumes: Task 3's fix (so this task's manual verification can exercise it against a working transport-coal map too, though the code change itself works identically for both models since it's inside the shared `dataset.customers.map(...)` loop).
- Produces: nothing new for other tasks.

**Current code (`artifacts/studio/src/components/NetworkMap.tsx:313-351`, the customer/station `<CircleMarker>` loop):**
```tsx
        {dataset.customers.map((c) => {
          const assignment = assignmentMap.get(c.id);
          const assignmentBand = assignment ? assignBand(assignment.distance, bands) : 0;
          const focused = isCustomerFocused(c.id);
          const dimmed = anySelection && !focused;
          const isCustomerSelected = c.id === selectedCustomerId;
          const isWarehouseHighlighted = hasWarehouseFilter && focused;

          const fillColor = isCustomerSelected
            ? getBandColor(assignmentBand)
            : isWarehouseHighlighted
              ? getBandColor(assignmentBand)
              : "#94A3B8";

          return (
            <CircleMarker
              key={c.id}
              center={[c.lat, c.lng]}
              radius={scaleDemand(c.demand)}
              pathOptions={{
                fillColor,
                fillOpacity: dimmed ? 0.15 : 0.8,
                color: isCustomerSelected
                  ? getBandColor(assignmentBand)
                  : isWarehouseHighlighted
                    ? getBandColor(assignmentBand)
                    : "#64748B",
                weight: isCustomerSelected ? 2.5 : isWarehouseHighlighted ? 1.5 : 1,
              }}
              eventHandlers={{
                click: (e) => {
                  L.DomEvent.stopPropagation(e);
                  setSelectedWarehouseId(null);
                  setSelectedCustomerId((prev) => (prev === c.id ? null : c.id));
                },
              }}
            />
          );
        })}
```

**Note on naming:** this component's fields are still named `customer`/`warehouse` even when rendering transport-coal's stations/mines (Task 2/3 map mines→warehouse role, stations→customer role onto the shared `Dataset` shape) — so `c.demand` here is either a real p-median customer's demand or a transport-coal station's demand; both are populated by Task 2's dataset loader.

- [ ] **Step 1: Write the failing test**

Create `artifacts/studio/src/__tests__/NetworkMap.test.tsx` (or add to it if it already exists — check first):

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { NetworkMap } from "@/components/NetworkMap";

const dataset = {
  warehouses: [{ id: "W1", city: "Testville", state: "TS", lat: 40, lng: -90 }],
  customers: [{ id: "C1", city: "Sampleburg", state: "SB", lat: 41, lng: -91, demand: 5000 }],
};

describe("NetworkMap customer/station hover tooltip", () => {
  it("renders a Tooltip for every customer/station marker", () => {
    const { container } = render(
      <NetworkMap
        dataset={dataset}
        warehouseStatuses={[]}
        result={null}
        showRoutes={false}
        bands={[500, 1000, 1500, 2000]}
      />,
    );
    // react-leaflet's Tooltip renders a .leaflet-tooltip pane element once
    // the marker mounts; assert its text content includes the customer's
    // city/state and demand, matching the existing warehouse Tooltip's
    // content style (NetworkMap.tsx:372-378).
    expect(container.textContent).toContain("Sampleburg, SB");
    expect(container.textContent).toContain("5,000");
  });
});
```

(If this repo's existing test setup requires a specific Leaflet/jsdom test wrapper for `MapContainer`-based components — check whether any other file already renders `NetworkMap` or another `MapContainer`-based component in a test, e.g. search `artifacts/studio/src/__tests__/` for `MapContainer` or `NetworkMap` — reuse that exact setup/mocking pattern instead of inventing a new one. If no prior art exists, this is the first such test in the repo; render normally, since react-leaflet/Leaflet already work under jsdom for this project's existing manual verification but may need `ResizeObserver` or similar polyfilled — check `artifacts/studio/vitest.config.ts`'s `setupFiles` for anything already handling this.)

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter studio test -- NetworkMap`
Expected: FAIL — no `Tooltip` is rendered for customer markers today (only warehouses have one, per `NetworkMap.tsx:372-378`).

- [ ] **Step 3: Apply the fix**

Add a `<Tooltip>` inside the `<CircleMarker>` in `artifacts/studio/src/components/NetworkMap.tsx:328-350`, following the exact same pattern as the existing warehouse `Tooltip` at line 372:

```tsx
          return (
            <CircleMarker
              key={c.id}
              center={[c.lat, c.lng]}
              radius={scaleDemand(c.demand)}
              pathOptions={{
                fillColor,
                fillOpacity: dimmed ? 0.15 : 0.8,
                color: isCustomerSelected
                  ? getBandColor(assignmentBand)
                  : isWarehouseHighlighted
                    ? getBandColor(assignmentBand)
                    : "#64748B",
                weight: isCustomerSelected ? 2.5 : isWarehouseHighlighted ? 1.5 : 1,
              }}
              eventHandlers={{
                click: (e) => {
                  L.DomEvent.stopPropagation(e);
                  setSelectedWarehouseId(null);
                  setSelectedCustomerId((prev) => (prev === c.id ? null : c.id));
                },
              }}
            >
              <Tooltip direction="top" offset={[0, -4]} opacity={1}>
                <span className="font-semibold text-xs">
                  {(c as unknown as { city?: string }).city ?? c.id}, {(c as unknown as { state?: string }).state ?? ""}
                  {" · "}{c.demand.toLocaleString()} {assignment ? `· Band ${assignmentBand + 1}` : ""}
                </span>
              </Tooltip>
            </CircleMarker>
          );
        })}
```

(This is a pure addition — the existing `pathOptions`/`eventHandlers` are untouched, so click-to-open-popup behavior via `CustomerPopup` still works exactly as before; the hover `Tooltip` and the click `Popup` are independent Leaflet UI elements and do not conflict, matching how warehouses already have both a `Tooltip` (hover) and a `click` handler (`handleWarehouseClick`) side by side today.)

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter studio test -- NetworkMap`
Expected: PASS.

- [ ] **Step 5: Run the full studio suite**

Run: `pnpm --filter studio test`
Expected: all pass, no regressions.

- [ ] **Step 6: Manual live verification**

Start local dev, open a p-median-us scenario, hover over a customer dot — confirm a tooltip appears with city/state/demand (and band, if solved). Open a transport-coal scenario (after Task 3 lands), hover over a station dot — confirm the same tooltip appears with the station's city/state/demand.

- [ ] **Step 7: Commit**

```bash
git add artifacts/studio/src/components/NetworkMap.tsx artifacts/studio/src/__tests__/NetworkMap.test.tsx
git commit -m "$(cat <<'EOF'
feat: add hover tooltip to customer/station markers

Only warehouse (and, once wired, mine) markers had a hover Tooltip; customer/
station CircleMarkers had none, only a click-to-open Popup. Adds a Tooltip
alongside the existing click handler, following the same pattern already
used for warehouse markers -- shows city/state/demand and, once solved, the
assigned distance band. Works for both p-median-us and transport-coal since
they share this one NetworkMap component.
EOF
)"
```

---

## Self-Review

**1. Spec coverage:**
- Issue 1 (map cut off at bottom) → Task 1. ✅
- Issue 4 (no routes shown after solve) → Tasks 2+3 (root cause: dataset not model-scoped). ✅
- Issue 5 (hover details on customer/warehouse) → Task 4 (warehouses already had this; customers/stations did not). ✅
- Issues 2, 3, 6 are explicitly out of scope for this plan — they are covered by the separate `2026-07-24-transport-coal-overrides.md` and `2026-07-24-map-multiselect-bulk-edit.md` plans per the user's explicit choice to split into three documents.

**2. Placeholder scan:** no TBD/"add appropriate"/"similar to Task N" found. The one spot with a conditional instruction ("check whether X already exists") in Tasks 2/3/4 is not a placeholder — it's a real repo-state check the implementer must do because the exact current state (does `dataset.test.ts` exist? what's the file's exact existing mock pattern?) genuinely wasn't confirmed byte-for-byte during planning for those specific sub-files, unlike every other quoted line in this plan which was read directly from the repo.

**3. Type consistency:** `useGetDataset({ modelId })` (Task 2's produced interface) matches Task 3's consumption exactly. `WarehouseCandidate`/`Customer` field names (`id`/`city`/`state`/`lat`/`lng`/`demand`) are used identically across Task 2's loader and Task 4's tooltip code — no renames introduced.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-24-studio-map-fixes.md`. Two more plans remain to be written for this same investigation (`2026-07-24-transport-coal-overrides.md` and `2026-07-24-map-multiselect-bulk-edit.md`) before any execution begins, per the user's explicit request to plan all three before building anything.
