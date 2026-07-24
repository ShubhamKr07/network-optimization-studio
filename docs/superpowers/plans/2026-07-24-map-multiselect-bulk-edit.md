# Map Multi-Select Bulk Edit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a student shift/ctrl-click multiple warehouse or customer markers directly on the map, then apply a bulk edit (set capacity/demand, or exclude/force-open) via a small floating toolbar that appears over the map — no dialog, matching the user's explicitly chosen UX (inline toolbar, not a pre-filtered table dialog).

**Architecture:** `NetworkMap.tsx` today has its own **internal, single-select** state (`selectedWarehouseId`/`selectedCustomerId`, both local `useState`) used purely for visual click-to-filter/inspect behavior (highlighting one warehouse's customers, or opening one customer's route popup) — there is currently zero data flow from map clicks into `Studio.tsx`'s override state at all. This plan adds a **second, independent selection concept** — multi-select, lifted up into `Studio.tsx` as controlled state and toggled via shift/ctrl-click — so the existing single-click filter/inspect behavior is completely undisturbed (plain clicks keep doing exactly what they do today; shift/ctrl-click is new). Ship Task 1 (multi-select toggling + visual highlight, generic to any model's dataset) and Task 2 (the toolbar, wired for p-median-us) first — these are fully executable today. Task 3 (extending the same toolbar to transport-coal's mines/stations) explicitly depends on `2026-07-24-transport-coal-overrides.md` having shipped `mineCapacities`/`stationDemands` first, since there is nothing to bulk-set on the coal model until those fields exist.

**Tech Stack:** React, react-leaflet (Leaflet 1.x — `CircleMarker`/`Marker` `eventHandlers`, whose Leaflet mouse event carries the real DOM `originalEvent` with `shiftKey`/`ctrlKey`/`metaKey`), Radix UI (`Button`/`Input`), Vitest + RTL.

## Global Constraints

- Plain (unmodified) click on a marker must continue to do **exactly** what it does today — single-select filter/inspect (`NetworkMap.tsx:236-242,343-348`) is completely unchanged by this plan. Multi-select only activates via shift-click or ctrl/cmd-click.
- A mixed selection (some warehouses/mines AND some customers/stations selected at once) has **no valid bulk action** — the toolbar must show a "select only one entity type at a time" message and disable every action button rather than guessing which fields to edit. Do not attempt to support cross-entity bulk edits.
- p-median-us's bulk actions are: set capacity (only when `capacityMode === "per_wh"`, mirroring `WarehouseTable`'s existing same-gate), force open, set inactive, set active/clear (warehouses); set demand, exclude, set active/clear (customers). transport-coal's bulk actions (Task 3 only) are: set capacity (mines), set demand (stations) — **no** exclude/force-open/inactive buttons for transport-coal, since neither mines nor stations have a status concept (per `2026-07-24-transport-coal-overrides.md`'s Global Constraints, carried over here).
- Full verification gate before considering any task done: `pnpm run typecheck && pnpm --filter studio test` (no backend/solver changes anywhere in this plan — it's a pure frontend UX addition writing into override fields both other plans already define the shape of).
- One task = one commit, message format `feat: <imperative summary>`.

---

### Task 1: Multi-select toggling and visual highlight on the map

**Files:**
- Modify: `artifacts/studio/src/components/NetworkMap.tsx`
- Test: `artifacts/studio/src/__tests__/NetworkMap.test.tsx` (created by `2026-07-24-studio-map-fixes.md`'s Task 4 — add to it; if that plan's Task 4 hasn't landed yet, create the file following this plan's own test below as the first entry)

**Interfaces:**
- Consumes: nothing from other tasks in this plan.
- Produces: two new controlled props on `NetworkMap` — `multiSelectedWarehouseIds: string[]`, `multiSelectedCustomerIds: string[]` — plus two new callback props, `onToggleWarehouseMultiSelect: (id: string) => void` and `onToggleCustomerMultiSelect: (id: string) => void`. Task 2 depends on these four exact prop names and the lifted-state pattern (multi-select state lives in `Studio.tsx`, not inside `NetworkMap`).

**Current warehouse marker code (`artifacts/studio/src/components/NetworkMap.tsx:353-382`):**
```tsx
        {dataset.warehouses.map((w) => {
          const status = getStatus(w.id);
          const isOpen = status === "open" || status === "forced_open";
          const isHighlighted = w.id === selectedWarehouseId;
          const isDimmed = hasWarehouseFilter && !isHighlighted && isOpen;

          return (
            <Marker
              key={w.id}
              position={[w.lat, w.lng]}
              icon={createTriangleIcon(status, isHighlighted, isDimmed)}
              eventHandlers={
                isOpen
                  ? {
                      click: (e) => handleWarehouseClick(w.id, status, e),
                    }
                  : undefined
              }
            >
              {isOpen && (
                <Tooltip direction="top" offset={[0, -10]} opacity={1}>
                  <span className="font-semibold text-xs">
                    {w.city}, {w.state}
                    {result && isOpen ? ` · ${warehouseCustomerIds && w.id === selectedWarehouseId ? warehouseCustomerIds.size : (result.edges.filter((e) => e.fromId === w.id).length)} customers` : ""}
                  </span>
                </Tooltip>
              )}
            </Marker>
          );
        })}
```

**Current `handleWarehouseClick` (`artifacts/studio/src/components/NetworkMap.tsx:236-242`):**
```tsx
  const handleWarehouseClick = (whId: string, status: string, e: L.LeafletMouseEvent) => {
    L.DomEvent.stopPropagation(e);
    // Only filter by open/forced_open warehouses that have assignments
    if (status !== "open" && status !== "forced_open") return;
    setSelectedCustomerId(null);
    setSelectedWarehouseId((prev) => (prev === whId ? null : whId));
  };
```

**Current customer marker click (`artifacts/studio/src/components/NetworkMap.tsx:342-348`):**
```tsx
              eventHandlers={{
                click: (e) => {
                  L.DomEvent.stopPropagation(e);
                  setSelectedWarehouseId(null);
                  setSelectedCustomerId((prev) => (prev === c.id ? null : c.id));
                },
              }}
```

- [ ] **Step 1: Write the failing test**

Add to `artifacts/studio/src/__tests__/NetworkMap.test.tsx`:

```tsx
it("calls onToggleWarehouseMultiSelect on shift-click without triggering the single-select filter", () => {
  const onToggleWarehouseMultiSelect = vi.fn();
  const dataset = {
    warehouses: [{ id: "W1", city: "Testville", state: "TS", lat: 40, lng: -90 }],
    customers: [],
  };
  render(
    <NetworkMap
      dataset={dataset}
      warehouseStatuses={[{ warehouseId: "W1", status: "forced_open" }]}
      result={null}
      showRoutes={false}
      bands={[500, 1000, 1500, 2000]}
      multiSelectedWarehouseIds={[]}
      multiSelectedCustomerIds={[]}
      onToggleWarehouseMultiSelect={onToggleWarehouseMultiSelect}
      onToggleCustomerMultiSelect={vi.fn()}
    />,
  );
  const marker = document.querySelector(".leaflet-marker-icon") as HTMLElement;
  fireEvent.click(marker, { shiftKey: true });
  expect(onToggleWarehouseMultiSelect).toHaveBeenCalledWith("W1");
});

it("renders a distinct highlight ring for warehouses in multiSelectedWarehouseIds", () => {
  const dataset = {
    warehouses: [{ id: "W1", city: "Testville", state: "TS", lat: 40, lng: -90 }],
    customers: [],
  };
  const { container } = render(
    <NetworkMap
      dataset={dataset}
      warehouseStatuses={[{ warehouseId: "W1", status: "forced_open" }]}
      result={null}
      showRoutes={false}
      bands={[500, 1000, 1500, 2000]}
      multiSelectedWarehouseIds={["W1"]}
      multiSelectedCustomerIds={[]}
      onToggleWarehouseMultiSelect={vi.fn()}
      onToggleCustomerMultiSelect={vi.fn()}
    />,
  );
  // The multi-select ring uses a distinct stroke color (#7C3AED, violet) from
  // the existing single-select highlight ring (#FCD34D, amber) so a student
  // can tell the two selection modes apart at a glance.
  expect(container.innerHTML).toContain("#7C3AED");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter studio test -- NetworkMap`
Expected: FAIL — `NetworkMap` doesn't accept these four props yet (TypeScript would actually reject the test file outright once typechecked; that's the correct "fails" signal here alongside the runtime assertion failure).

- [ ] **Step 3: Apply the fix**

Add the four new props to `NetworkMapProps` (`artifacts/studio/src/components/NetworkMap.tsx:149-162`):

```tsx
interface NetworkMapProps {
  dataset: Dataset;
  warehouseStatuses: WarehouseStatusEntry[];
  result: SolveResult | null;
  showRoutes: boolean;
  bands: number[];
  countryBounds?: CountryBounds;
  // Multi-select (shift/ctrl-click) is lifted state, independent of this
  // component's own single-select filter/inspect state above — Studio.tsx
  // owns it so it can render a bulk-edit toolbar outside this component.
  multiSelectedWarehouseIds: string[];
  multiSelectedCustomerIds: string[];
  onToggleWarehouseMultiSelect: (id: string) => void;
  onToggleCustomerMultiSelect: (id: string) => void;
}

export function NetworkMap({
  dataset, warehouseStatuses, result, showRoutes, bands, countryBounds,
  multiSelectedWarehouseIds, multiSelectedCustomerIds,
  onToggleWarehouseMultiSelect, onToggleCustomerMultiSelect,
}: NetworkMapProps) {
```

Update `handleWarehouseClick` to branch on the modifier key:

```tsx
  const handleWarehouseClick = (whId: string, status: string, e: L.LeafletMouseEvent) => {
    L.DomEvent.stopPropagation(e);
    if (e.originalEvent.shiftKey || e.originalEvent.ctrlKey || e.originalEvent.metaKey) {
      onToggleWarehouseMultiSelect(whId);
      return;
    }
    // Only filter by open/forced_open warehouses that have assignments
    if (status !== "open" && status !== "forced_open") return;
    setSelectedCustomerId(null);
    setSelectedWarehouseId((prev) => (prev === whId ? null : whId));
  };
```

(Note: unlike the existing single-select filter, multi-select must work for **any** warehouse regardless of open/forced_open/potential/inactive status — a student may want to bulk-select currently-inactive warehouses to force them open, for example — so the modifier-key branch returns immediately, before the `status !== "open" && status !== "forced_open"` guard that only applies to single-select filtering.)

Update the customer marker's click handler:

```tsx
              eventHandlers={{
                click: (e) => {
                  L.DomEvent.stopPropagation(e);
                  if (e.originalEvent.shiftKey || e.originalEvent.ctrlKey || e.originalEvent.metaKey) {
                    onToggleCustomerMultiSelect(c.id);
                    return;
                  }
                  setSelectedWarehouseId(null);
                  setSelectedCustomerId((prev) => (prev === c.id ? null : c.id));
                },
              }}
```

Add the multi-select visual ring to `createTriangleIcon` (`artifacts/studio/src/components/NetworkMap.tsx:27-70`) — add a new `multiSelected` parameter:

```tsx
const createTriangleIcon = (
  status: "potential" | "forced_open" | "inactive" | "open",
  highlighted = false,
  dimmed = false,
  multiSelected = false,
) => {
  let fill = "none";
  let stroke = "#64748B";
  let strokeWidth = "2";
  let dash = "";
  let extraCircle = "";

  if (status === "open" || status === "forced_open") {
    fill = highlighted ? "#15803D" : "#16A34A";
    stroke = highlighted ? "#15803D" : "#16A34A";
  } else if (status === "inactive") {
    stroke = "#DC2626";
    dash = 'stroke-dasharray="4"';
  }

  if (status === "forced_open") {
    extraCircle = `<circle cx="12" cy="12" r="10" fill="none" stroke="#2D6CDF" stroke-width="1.5" stroke-dasharray="3" />`;
  }

  const ringCircle = highlighted
    ? `<circle cx="12" cy="12" r="11" fill="none" stroke="#FCD34D" stroke-width="2" />`
    : "";
  // Multi-select ring uses a distinct violet stroke so it's visually
  // unambiguous from the amber single-select ring above, and can coexist
  // with it (a warehouse can be both single-selected and multi-selected).
  const multiSelectRing = multiSelected
    ? `<circle cx="12" cy="12" r="9" fill="none" stroke="#7C3AED" stroke-width="2.5" />`
    : "";

  const opacity = dimmed ? 0.25 : 1;
  const size = highlighted ? 32 : 24;
  const anchor = highlighted ? 16 : 12;

  const svg = `<svg width="${size}" height="${size}" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" opacity="${opacity}">
    ${ringCircle}
    ${multiSelectRing}
    ${extraCircle}
    <polygon points="12,2 22,20 2,20" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}" ${dash} />
  </svg>`;

  return L.divIcon({
    html: svg,
    className: "",
    iconSize: [size, size],
    iconAnchor: [anchor, anchor],
  });
};
```

Update the warehouse marker's `createTriangleIcon` call (`artifacts/studio/src/components/NetworkMap.tsx:363`):

```tsx
              icon={createTriangleIcon(status, isHighlighted, isDimmed, multiSelectedWarehouseIds.includes(w.id))}
```

Update the customer `CircleMarker`'s `pathOptions` (`artifacts/studio/src/components/NetworkMap.tsx:332-341`) to add the same violet ring when multi-selected:

```tsx
              pathOptions={{
                fillColor,
                fillOpacity: dimmed ? 0.15 : 0.8,
                color: multiSelectedCustomerIds.includes(c.id)
                  ? "#7C3AED"
                  : isCustomerSelected
                    ? getBandColor(assignmentBand)
                    : isWarehouseHighlighted
                      ? getBandColor(assignmentBand)
                      : "#64748B",
                weight: multiSelectedCustomerIds.includes(c.id) ? 3 : isCustomerSelected ? 2.5 : isWarehouseHighlighted ? 1.5 : 1,
              }}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter studio test -- NetworkMap`
Expected: PASS.

- [ ] **Step 5: Update every other caller of `NetworkMap` to pass the four new required props**

Search for every place `<NetworkMap` is rendered (`grep -rn "<NetworkMap" artifacts/studio/src`) — this will include `Studio.tsx` (Task 2 wires this for real) and any existing test file rendering it without the new props (fix those call sites to pass empty arrays/no-op functions so they keep compiling and passing, since this task's job is only to add the capability, not yet wire Studio.tsx's real bulk-edit state — that's Task 2).

- [ ] **Step 6: Run the full studio suite and typecheck**

Run: `pnpm run typecheck && pnpm --filter studio test`
Expected: clean, all pass.

- [ ] **Step 7: Commit**

```bash
git add artifacts/studio/src/components/NetworkMap.tsx artifacts/studio/src/__tests__/
git commit -m "$(cat <<'EOF'
feat: shift/ctrl-click multi-select on map markers

Adds a second, independent selection concept to NetworkMap alongside its
existing single-click filter/inspect state: shift/ctrl/cmd-click toggles a
marker's id into a lifted (Studio.tsx-owned) multiSelectedWarehouseIds/
multiSelectedCustomerIds array, visually distinguished with a violet ring
from the existing amber single-select highlight. Plain clicks are completely
unchanged. This task only adds the toggle + visual; the bulk-edit toolbar
that acts on the selection is the next task.
EOF
)"
```

---

### Task 2: Floating bulk-edit toolbar, wired for p-median-us

**Files:**
- Create: `artifacts/studio/src/components/MapBulkEditToolbar.tsx`
- Modify: `artifacts/studio/src/pages/Studio.tsx` (lift multi-select state, render the toolbar over the map, wire its bulk actions into `warehouseOverrides`/`customerOverrides`)
- Test: `artifacts/studio/src/__tests__/MapBulkEditToolbar.test.tsx`, additions to `Studio.test.tsx`

**Interfaces:**
- Consumes: Task 1's four `NetworkMap` props; p-median-us's existing `WarehouseOverride { id, capacity?, status }` / `CustomerOverride { id, demand?, status }` types (`artifacts/studio/src/components/tables/WarehouseTable.tsx:5`, `CustomerTable.tsx:5`).
- Produces: `MapBulkEditToolbar`'s props contract, consumed only by `Studio.tsx` in this plan.

**`Studio.tsx`'s map render call site to modify (`artifacts/studio/src/pages/Studio.tsx:1094-1114`):**
```tsx
            <div className="flex-1 min-h-0 relative">
              {currentScenario?.modelId === "p-median-brazil" ? (
                <BrazilMap
                  result={activeTab === "output" ? result : null}
                  showRoutes={activeTab === "output" && showRoutes}
                />
              ) : dataset ? (
                <NetworkMap
                  dataset={dataset}
                  warehouseStatuses={(localConfig?.warehouseOverrides ?? [])
                    .filter(o => o.status !== "active")
                    .map(o => ({ warehouseId: o.id, status: o.status as "forced_open" | "inactive" }))}
                  result={activeTab === "output" ? result : null}
                  showRoutes={activeTab === "output" && showRoutes}
                  bands={bands}
                  countryBounds={activeModelManifest?.countryBounds}
                />
              ) : (
                <div className="flex items-center justify-center h-full text-muted-foreground text-sm">Loading map...</div>
              )}
            </div>
```

- [ ] **Step 1: Write the failing test for the toolbar component in isolation**

Create `artifacts/studio/src/__tests__/MapBulkEditToolbar.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MapBulkEditToolbar } from "@/components/MapBulkEditToolbar";

describe("MapBulkEditToolbar", () => {
  it("renders nothing when nothing is selected", () => {
    const { container } = render(
      <MapBulkEditToolbar
        selectedWarehouseIds={[]}
        selectedCustomerIds={[]}
        capacityMode="per_wh"
        onSetWarehouseCapacity={vi.fn()}
        onSetWarehouseStatus={vi.fn()}
        onSetCustomerDemand={vi.fn()}
        onSetCustomerStatus={vi.fn()}
        onClearSelection={vi.fn()}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("shows a mixed-selection warning and disables all actions when both warehouses and customers are selected", () => {
    render(
      <MapBulkEditToolbar
        selectedWarehouseIds={["W1"]}
        selectedCustomerIds={["C1"]}
        capacityMode="per_wh"
        onSetWarehouseCapacity={vi.fn()}
        onSetWarehouseStatus={vi.fn()}
        onSetCustomerDemand={vi.fn()}
        onSetCustomerStatus={vi.fn()}
        onClearSelection={vi.fn()}
      />,
    );
    expect(screen.getByText(/select only one entity type/i)).toBeInTheDocument();
    expect(screen.queryByTestId("button-bulk-set-capacity")).not.toBeInTheDocument();
  });

  it("applies a bulk capacity set to all selected warehouses", async () => {
    const onSetWarehouseCapacity = vi.fn();
    render(
      <MapBulkEditToolbar
        selectedWarehouseIds={["W1", "W2"]}
        selectedCustomerIds={[]}
        capacityMode="per_wh"
        onSetWarehouseCapacity={onSetWarehouseCapacity}
        onSetWarehouseStatus={vi.fn()}
        onSetCustomerDemand={vi.fn()}
        onSetCustomerStatus={vi.fn()}
        onClearSelection={vi.fn()}
      />,
    );
    await userEvent.type(screen.getByTestId("input-bulk-capacity"), "50000");
    await userEvent.click(screen.getByTestId("button-bulk-set-capacity"));
    expect(onSetWarehouseCapacity).toHaveBeenCalledWith(["W1", "W2"], 50000);
  });

  it("applies a bulk exclude to all selected customers", async () => {
    const onSetCustomerStatus = vi.fn();
    render(
      <MapBulkEditToolbar
        selectedWarehouseIds={[]}
        selectedCustomerIds={["C1", "C2"]}
        capacityMode="none"
        onSetWarehouseCapacity={vi.fn()}
        onSetWarehouseStatus={vi.fn()}
        onSetCustomerDemand={vi.fn()}
        onSetCustomerStatus={onSetCustomerStatus}
        onClearSelection={vi.fn()}
      />,
    );
    await userEvent.click(screen.getByTestId("button-bulk-exclude"));
    expect(onSetCustomerStatus).toHaveBeenCalledWith(["C1", "C2"], "excluded");
  });

  it("hides the capacity input when capacityMode is not per_wh", () => {
    render(
      <MapBulkEditToolbar
        selectedWarehouseIds={["W1"]}
        selectedCustomerIds={[]}
        capacityMode="uniform"
        onSetWarehouseCapacity={vi.fn()}
        onSetWarehouseStatus={vi.fn()}
        onSetCustomerDemand={vi.fn()}
        onSetCustomerStatus={vi.fn()}
        onClearSelection={vi.fn()}
      />,
    );
    expect(screen.queryByTestId("input-bulk-capacity")).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter studio test -- MapBulkEditToolbar`
Expected: FAIL — component doesn't exist yet.

- [ ] **Step 3: Create `MapBulkEditToolbar.tsx`**

```tsx
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface MapBulkEditToolbarProps {
  selectedWarehouseIds: string[];
  selectedCustomerIds: string[];
  capacityMode: "none" | "uniform" | "per_wh";
  onSetWarehouseCapacity: (ids: string[], capacity: number) => void;
  onSetWarehouseStatus: (ids: string[], status: "active" | "forced_open" | "inactive") => void;
  onSetCustomerDemand: (ids: string[], demand: number) => void;
  onSetCustomerStatus: (ids: string[], status: "active" | "excluded") => void;
  onClearSelection: () => void;
}

export function MapBulkEditToolbar({
  selectedWarehouseIds, selectedCustomerIds, capacityMode,
  onSetWarehouseCapacity, onSetWarehouseStatus,
  onSetCustomerDemand, onSetCustomerStatus,
  onClearSelection,
}: MapBulkEditToolbarProps) {
  const [capacityDraft, setCapacityDraft] = useState("");
  const [demandDraft, setDemandDraft] = useState("");

  const hasWarehouses = selectedWarehouseIds.length > 0;
  const hasCustomers = selectedCustomerIds.length > 0;
  const isMixed = hasWarehouses && hasCustomers;

  if (!hasWarehouses && !hasCustomers) return null;

  return (
    <div
      className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-white border border-border rounded-lg shadow-lg px-4 py-2.5 flex items-center gap-2 z-20 text-xs"
      data-testid="map-bulk-edit-toolbar"
    >
      {isMixed ? (
        <span className="text-muted-foreground italic">
          Select only one entity type at a time to bulk-edit (warehouses or customers, not both).
        </span>
      ) : hasWarehouses ? (
        <>
          <span className="font-semibold">{selectedWarehouseIds.length} warehouse{selectedWarehouseIds.length > 1 ? "s" : ""} selected</span>
          {capacityMode === "per_wh" && (
            <>
              <Input
                type="number"
                min={0}
                placeholder="Capacity"
                value={capacityDraft}
                onChange={(e) => setCapacityDraft(e.target.value)}
                className="h-7 text-xs w-24"
                data-testid="input-bulk-capacity"
              />
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs"
                data-testid="button-bulk-set-capacity"
                disabled={capacityDraft === ""}
                onClick={() => onSetWarehouseCapacity(selectedWarehouseIds, Math.max(0, parseInt(capacityDraft, 10) || 0))}
              >
                Set capacity
              </Button>
            </>
          )}
          <Button size="sm" variant="outline" className="h-7 text-xs" data-testid="button-bulk-force-open"
            onClick={() => onSetWarehouseStatus(selectedWarehouseIds, "forced_open")}>
            Force open
          </Button>
          <Button size="sm" variant="outline" className="h-7 text-xs" data-testid="button-bulk-inactive"
            onClick={() => onSetWarehouseStatus(selectedWarehouseIds, "inactive")}>
            Set inactive
          </Button>
          <Button size="sm" variant="ghost" className="h-7 text-xs" data-testid="button-bulk-clear-status"
            onClick={() => onSetWarehouseStatus(selectedWarehouseIds, "active")}>
            Clear overrides
          </Button>
        </>
      ) : (
        <>
          <span className="font-semibold">{selectedCustomerIds.length} customer{selectedCustomerIds.length > 1 ? "s" : ""} selected</span>
          <Input
            type="number"
            min={0}
            placeholder="Demand"
            value={demandDraft}
            onChange={(e) => setDemandDraft(e.target.value)}
            className="h-7 text-xs w-24"
            data-testid="input-bulk-demand"
          />
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs"
            data-testid="button-bulk-set-demand"
            disabled={demandDraft === ""}
            onClick={() => onSetCustomerDemand(selectedCustomerIds, Math.max(0, parseInt(demandDraft, 10) || 0))}
          >
            Set demand
          </Button>
          <Button size="sm" variant="outline" className="h-7 text-xs" data-testid="button-bulk-exclude"
            onClick={() => onSetCustomerStatus(selectedCustomerIds, "excluded")}>
            Exclude
          </Button>
          <Button size="sm" variant="ghost" className="h-7 text-xs" data-testid="button-bulk-clear-status"
            onClick={() => onSetCustomerStatus(selectedCustomerIds, "active")}>
            Clear overrides
          </Button>
        </>
      )}
      <Button size="sm" variant="ghost" className="h-7 text-xs" data-testid="button-bulk-cancel" onClick={onClearSelection}>
        Cancel
      </Button>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter studio test -- MapBulkEditToolbar`
Expected: PASS.

- [ ] **Step 5: Wire into `Studio.tsx`**

Add state (alongside the component's other `useState` declarations):

```tsx
  const [multiSelectedWarehouseIds, setMultiSelectedWarehouseIds] = useState<string[]>([]);
  const [multiSelectedCustomerIds, setMultiSelectedCustomerIds] = useState<string[]>([]);

  const toggleWarehouseMultiSelect = (id: string) => {
    setMultiSelectedCustomerIds([]); // selecting a warehouse clears any customer selection -- enforces the "one entity type at a time" rule at the toggle site, not just in the toolbar's disabled-state display
    setMultiSelectedWarehouseIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };
  const toggleCustomerMultiSelect = (id: string) => {
    setMultiSelectedWarehouseIds([]);
    setMultiSelectedCustomerIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };
  const clearMultiSelection = () => {
    setMultiSelectedWarehouseIds([]);
    setMultiSelectedCustomerIds([]);
  };

  function bulkUpsertWarehouseOverrides(ids: string[], patch: Partial<WarehouseOverride>) {
    if (!localConfig) return;
    const rest = localConfig.warehouseOverrides.filter(o => !ids.includes(o.id));
    const applied = ids.map(id => {
      const existing = localConfig.warehouseOverrides.find(o => o.id === id);
      const merged: WarehouseOverride = { id, status: existing?.status ?? "active", capacity: existing?.capacity, ...patch };
      return merged;
    }).filter(o => !(o.status === "active" && o.capacity == null));
    update("warehouseOverrides", [...rest, ...applied]);
  }

  function bulkUpsertCustomerOverrides(ids: string[], patch: Partial<CustomerOverride>) {
    if (!localConfig) return;
    const rest = localConfig.customerOverrides.filter(o => !ids.includes(o.id));
    const applied = ids.map(id => {
      const existing = localConfig.customerOverrides.find(o => o.id === id);
      const merged: CustomerOverride = { id, status: existing?.status ?? "active", demand: existing?.demand, ...patch };
      return merged;
    }).filter(o => !(o.status === "active" && o.demand == null));
    update("customerOverrides", [...rest, ...applied]);
  }
```

(This mirrors `WarehouseTable.tsx:30-41`'s `upsert` function's exact merge/no-op rule, just applied to a list of ids at once instead of one id.)

Replace the map render call site (`artifacts/studio/src/pages/Studio.tsx:1094-1114`):

```tsx
            <div className="flex-1 min-h-0 relative">
              {currentScenario?.modelId === "p-median-brazil" ? (
                <BrazilMap
                  result={activeTab === "output" ? result : null}
                  showRoutes={activeTab === "output" && showRoutes}
                />
              ) : dataset ? (
                <>
                  <NetworkMap
                    dataset={dataset}
                    warehouseStatuses={(localConfig?.warehouseOverrides ?? [])
                      .filter(o => o.status !== "active")
                      .map(o => ({ warehouseId: o.id, status: o.status as "forced_open" | "inactive" }))}
                    result={activeTab === "output" ? result : null}
                    showRoutes={activeTab === "output" && showRoutes}
                    bands={bands}
                    countryBounds={activeModelManifest?.countryBounds}
                    multiSelectedWarehouseIds={modelId === "p-median-us" ? multiSelectedWarehouseIds : []}
                    multiSelectedCustomerIds={modelId === "p-median-us" ? multiSelectedCustomerIds : []}
                    onToggleWarehouseMultiSelect={toggleWarehouseMultiSelect}
                    onToggleCustomerMultiSelect={toggleCustomerMultiSelect}
                  />
                  {modelId === "p-median-us" && localConfig && (
                    <MapBulkEditToolbar
                      selectedWarehouseIds={multiSelectedWarehouseIds}
                      selectedCustomerIds={multiSelectedCustomerIds}
                      capacityMode={localConfig.capacityMode}
                      onSetWarehouseCapacity={(ids, capacity) => { bulkUpsertWarehouseOverrides(ids, { capacity }); clearMultiSelection(); }}
                      onSetWarehouseStatus={(ids, status) => { bulkUpsertWarehouseOverrides(ids, { status, capacity: status === "active" ? null : undefined }); clearMultiSelection(); }}
                      onSetCustomerDemand={(ids, demand) => { bulkUpsertCustomerOverrides(ids, { demand }); clearMultiSelection(); }}
                      onSetCustomerStatus={(ids, status) => { bulkUpsertCustomerOverrides(ids, { status, demand: status === "active" ? null : undefined }); clearMultiSelection(); }}
                      onClearSelection={clearMultiSelection}
                    />
                  )}
                </>
              ) : (
                <div className="flex items-center justify-center h-full text-muted-foreground text-sm">Loading map...</div>
              )}
            </div>
```

(`multiSelectedWarehouseIds`/`multiSelectedCustomerIds` are gated to `[]` for any model other than p-median-us in this task — Task 3 lifts that gate for transport-coal once its override fields exist. Import `MapBulkEditToolbar` and `WarehouseOverride`/`CustomerOverride` types at the top of the file if not already imported.)

- [ ] **Step 6: Add a Studio.tsx RTL test**

Add to `artifacts/studio/src/__tests__/Studio.test.tsx`:

```tsx
it("shift-clicking two warehouse markers shows the bulk-edit toolbar", async () => {
  renderStudioForModel("p-median-us"); // reuse this file's existing render helper
  const markers = document.querySelectorAll(".leaflet-marker-icon");
  fireEvent.click(markers[0], { shiftKey: true });
  fireEvent.click(markers[1], { shiftKey: true });
  expect(screen.getByTestId("map-bulk-edit-toolbar")).toBeInTheDocument();
  expect(screen.getByText(/2 warehouses selected/i)).toBeInTheDocument();
});

it("applying a bulk exclude to selected customers updates localConfig.customerOverrides", async () => {
  renderStudioForModel("p-median-us");
  const markers = document.querySelectorAll(".leaflet-interactive"); // CircleMarker customer dots
  fireEvent.click(markers[0], { shiftKey: true });
  await userEvent.click(screen.getByTestId("button-bulk-exclude"));
  // Assert via whatever this file's existing convention is for reading back
  // localConfig state after an update -- e.g. re-opening the Customer table
  // dialog and checking the row's status, matching how other override tests
  // in this file already verify a change round-tripped.
});
```

- [ ] **Step 7: Run the full studio suite and typecheck**

Run: `pnpm run typecheck && pnpm --filter studio test`
Expected: clean, all pass.

- [ ] **Step 8: Manual live verification**

Start local dev, open a p-median-us scenario with `capacityMode = "per_wh"`. Shift-click 2-3 warehouse markers, confirm the violet ring appears and the toolbar shows at the bottom of the map with a capacity input + Force open/Set inactive/Clear/Cancel buttons. Set a capacity, confirm it persists (check via the existing Warehouses table dialog that the same override now shows there too — same `warehouseOverrides` array, so it must). Repeat for customers (shift-click dots, set demand, exclude).

- [ ] **Step 9: Commit**

```bash
git add artifacts/studio/src/components/MapBulkEditToolbar.tsx artifacts/studio/src/pages/Studio.tsx \
  artifacts/studio/src/__tests__/MapBulkEditToolbar.test.tsx artifacts/studio/src/__tests__/Studio.test.tsx
git commit -m "$(cat <<'EOF'
feat: inline map bulk-edit toolbar for p-median-us warehouses/customers

New MapBulkEditToolbar.tsx floats over the map (no dialog) once 1+ markers
are multi-selected (prior task's shift/ctrl-click). Warehouses: set capacity
(per_wh mode only, mirrors WarehouseTable's own gate), force open, set
inactive, clear. Customers: set demand, exclude, clear. A mixed warehouse+
customer selection disables every action with an explanatory message rather
than guessing which fields to bulk-edit. Writes into the exact same
warehouseOverrides/customerOverrides arrays the existing table dialogs use,
so both editing paths stay consistent.
EOF
)"
```

---

### Task 3: Extend the bulk-edit toolbar to transport-coal (mines/stations)

**Files:**
- Modify: `artifacts/studio/src/components/MapBulkEditToolbar.tsx`
- Modify: `artifacts/studio/src/pages/Studio.tsx`
- Test: additions to `MapBulkEditToolbar.test.tsx`, `Studio.test.tsx`

**Interfaces:**
- Consumes: `2026-07-24-transport-coal-overrides.md`'s `MineOverride { id, capacity? }` / `StationOverride { id, demand? }` types and `mineCapacities`/`stationDemands` fields — **this task cannot start until that plan's Phase A (Tasks 1-3) and Phase B (Tasks 4-6) have both shipped**, since there is no `capacity`/`demand` override concept on transport-coal before then.

**Design difference from p-median-us:** transport-coal has no status concept at all (per the other plan's Global Constraints) — so the toolbar's warehouse-role branch (now representing mines) must drop the "Force open"/"Set inactive"/"Clear overrides"(status) buttons entirely when the active model is transport-coal, leaving only "Set capacity". Same for the customer-role branch (now representing stations): only "Set demand", no "Exclude".

- [ ] **Step 1: Write the failing test**

Add to `MapBulkEditToolbar.test.tsx`:

```tsx
it("hides status buttons entirely for transport-coal (mines have no status concept)", () => {
  render(
    <MapBulkEditToolbar
      selectedWarehouseIds={["KY"]}
      selectedCustomerIds={[]}
      capacityMode="per_wh"
      entityKind="mine-station"
      onSetWarehouseCapacity={vi.fn()}
      onSetWarehouseStatus={vi.fn()}
      onSetCustomerDemand={vi.fn()}
      onSetCustomerStatus={vi.fn()}
      onClearSelection={vi.fn()}
    />,
  );
  expect(screen.getByTestId("button-bulk-set-capacity")).toBeInTheDocument();
  expect(screen.queryByTestId("button-bulk-force-open")).not.toBeInTheDocument();
  expect(screen.queryByTestId("button-bulk-inactive")).not.toBeInTheDocument();
  expect(screen.queryByTestId("button-bulk-clear-status")).not.toBeInTheDocument();
});

it("hides the exclude button for transport-coal stations", () => {
  render(
    <MapBulkEditToolbar
      selectedWarehouseIds={[]}
      selectedCustomerIds={["CHI"]}
      capacityMode="none"
      entityKind="mine-station"
      onSetWarehouseCapacity={vi.fn()}
      onSetWarehouseStatus={vi.fn()}
      onSetCustomerDemand={vi.fn()}
      onSetCustomerStatus={vi.fn()}
      onClearSelection={vi.fn()}
    />,
  );
  expect(screen.getByTestId("button-bulk-set-demand")).toBeInTheDocument();
  expect(screen.queryByTestId("button-bulk-exclude")).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter studio test -- MapBulkEditToolbar`
Expected: FAIL — the component has no `entityKind` prop yet, and always renders the status buttons.

- [ ] **Step 3: Apply the fix**

Add an `entityKind?: "warehouse-customer" | "mine-station"` prop (default `"warehouse-customer"`) to `MapBulkEditToolbarProps`, and wrap the status-button JSX in a check:

```tsx
interface MapBulkEditToolbarProps {
  selectedWarehouseIds: string[];
  selectedCustomerIds: string[];
  capacityMode: "none" | "uniform" | "per_wh";
  entityKind?: "warehouse-customer" | "mine-station";
  onSetWarehouseCapacity: (ids: string[], capacity: number) => void;
  onSetWarehouseStatus: (ids: string[], status: "active" | "forced_open" | "inactive") => void;
  onSetCustomerDemand: (ids: string[], demand: number) => void;
  onSetCustomerStatus: (ids: string[], status: "active" | "excluded") => void;
  onClearSelection: () => void;
}

export function MapBulkEditToolbar({
  selectedWarehouseIds, selectedCustomerIds, capacityMode, entityKind = "warehouse-customer",
  onSetWarehouseCapacity, onSetWarehouseStatus,
  onSetCustomerDemand, onSetCustomerStatus,
  onClearSelection,
}: MapBulkEditToolbarProps) {
```

In the warehouse-role branch, wrap the three status buttons:
```tsx
          {entityKind === "warehouse-customer" && (
            <>
              <Button size="sm" variant="outline" className="h-7 text-xs" data-testid="button-bulk-force-open"
                onClick={() => onSetWarehouseStatus(selectedWarehouseIds, "forced_open")}>
                Force open
              </Button>
              <Button size="sm" variant="outline" className="h-7 text-xs" data-testid="button-bulk-inactive"
                onClick={() => onSetWarehouseStatus(selectedWarehouseIds, "inactive")}>
                Set inactive
              </Button>
              <Button size="sm" variant="ghost" className="h-7 text-xs" data-testid="button-bulk-clear-status"
                onClick={() => onSetWarehouseStatus(selectedWarehouseIds, "active")}>
                Clear overrides
              </Button>
            </>
          )}
```

In the customer-role branch, wrap the exclude/clear-status buttons the same way:
```tsx
          {entityKind === "warehouse-customer" && (
            <>
              <Button size="sm" variant="outline" className="h-7 text-xs" data-testid="button-bulk-exclude"
                onClick={() => onSetCustomerStatus(selectedCustomerIds, "excluded")}>
                Exclude
              </Button>
              <Button size="sm" variant="ghost" className="h-7 text-xs" data-testid="button-bulk-clear-status"
                onClick={() => onSetCustomerStatus(selectedCustomerIds, "active")}>
                Clear overrides
              </Button>
            </>
          )}
```

("Set capacity"/"Set demand" and "Cancel" remain unconditional in both branches — they're valid for both entity kinds.)

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter studio test -- MapBulkEditToolbar`
Expected: PASS.

- [ ] **Step 5: Wire into `Studio.tsx` for transport-coal**

Lift the `modelId === "p-median-us"` gate on `multiSelectedWarehouseIds`/`multiSelectedCustomerIds` (Task 2 Step 5's map render call site) to also allow `"transport-coal"`:

```tsx
                    multiSelectedWarehouseIds={(modelId === "p-median-us" || modelId === "transport-coal") ? multiSelectedWarehouseIds : []}
                    multiSelectedCustomerIds={(modelId === "p-median-us" || modelId === "transport-coal") ? multiSelectedCustomerIds : []}
```

Add a second, transport-coal-scoped rendering of the toolbar (or generalize the existing one's gate — either is acceptable; generalizing is simpler since the bulk-upsert handlers differ only in which override array/type they touch):

```tsx
                  {(modelId === "p-median-us" || modelId === "transport-coal") && localConfig && (
                    <MapBulkEditToolbar
                      selectedWarehouseIds={multiSelectedWarehouseIds}
                      selectedCustomerIds={multiSelectedCustomerIds}
                      capacityMode={modelId === "p-median-us" ? localConfig.capacityMode : "per_wh"}
                      entityKind={modelId === "transport-coal" ? "mine-station" : "warehouse-customer"}
                      onSetWarehouseCapacity={(ids, capacity) => {
                        if (modelId === "transport-coal") {
                          const rest = localConfig.mineCapacities.filter(o => !ids.includes(o.id));
                          update("mineCapacities", [...rest, ...ids.map(id => ({ id, capacity }))]);
                        } else {
                          bulkUpsertWarehouseOverrides(ids, { capacity });
                        }
                        clearMultiSelection();
                      }}
                      onSetWarehouseStatus={(ids, status) => { bulkUpsertWarehouseOverrides(ids, { status, capacity: status === "active" ? null : undefined }); clearMultiSelection(); }}
                      onSetCustomerDemand={(ids, demand) => {
                        if (modelId === "transport-coal") {
                          const rest = localConfig.stationDemands.filter(o => !ids.includes(o.id));
                          update("stationDemands", [...rest, ...ids.map(id => ({ id, demand }))]);
                        } else {
                          bulkUpsertCustomerOverrides(ids, { demand });
                        }
                        clearMultiSelection();
                      }}
                      onSetCustomerStatus={(ids, status) => { bulkUpsertCustomerOverrides(ids, { status, demand: status === "active" ? null : undefined }); clearMultiSelection(); }}
                      onClearSelection={clearMultiSelection}
                    />
                  )}
```

(`capacityMode={modelId === "p-median-us" ? localConfig.capacityMode : "per_wh"}` — transport-coal's mine capacity override is always editable regardless of any capacity-mode toggle, since it has no such concept; passing `"per_wh"` reuses the toolbar's existing "show the capacity input" gate without adding a third prop just for this. `onSetWarehouseStatus`/`onSetCustomerStatus` are still passed through unconditionally to satisfy the props contract, but `entityKind="mine-station"` ensures the buttons that would call them are never rendered for transport-coal, so they're simply unreachable dead branches in that case — not a bug, just an unused callback path the type signature still requires.)

- [ ] **Step 6: Add a Studio.tsx RTL test**

Mirror Task 2 Step 6's tests, substituting a transport-coal scenario and asserting the toolbar shows only "Set capacity"/"Cancel" for a mine selection (no Force open/Set inactive), and only "Set demand"/"Cancel" for a station selection (no Exclude).

- [ ] **Step 7: Run the full studio suite and typecheck**

Run: `pnpm run typecheck && pnpm --filter studio test`
Expected: clean, all pass.

- [ ] **Step 8: Manual live verification**

Start local dev, open a transport-coal scenario. Shift-click 2 mine markers, confirm the toolbar shows only a capacity input + Set capacity + Cancel (no status buttons). Set a capacity, confirm it persists by opening the Mine table dialog (from the other plan) and checking the same override shows there. Repeat for stations (set demand, confirm via the Station table dialog).

- [ ] **Step 9: Commit**

```bash
git add artifacts/studio/src/components/MapBulkEditToolbar.tsx artifacts/studio/src/pages/Studio.tsx \
  artifacts/studio/src/__tests__/MapBulkEditToolbar.test.tsx artifacts/studio/src/__tests__/Studio.test.tsx
git commit -m "$(cat <<'EOF'
feat: extend map bulk-edit toolbar to transport-coal mines/stations

New entityKind prop ("warehouse-customer" | "mine-station") hides the
status-only buttons (Force open/Set inactive/Exclude/Clear overrides) for
transport-coal, since mines/stations have no status concept at all -- only
Set capacity (mines) / Set demand (stations) apply. Writes into
mineCapacities/stationDemands (the sparse-dict override fields from the
transport-coal-overrides plan) instead of warehouseOverrides/
customerOverrides.
EOF
)"
```

---

## Self-Review

**1. Spec coverage:** Issue 6 (map-based multi-select with an inline bulk-edit toolbar, per the user's explicit chosen UX) is covered by Task 1 (selection mechanism) + Task 2 (p-median-us toolbar) + Task 3 (transport-coal extension). The "mixed selection has no valid action" edge case and the "no status concept for transport-coal" constraint (both real design questions surfaced during planning, not afterthoughts) are handled explicitly in Tasks 2 and 3 respectively, not silently ignored.

**2. Placeholder scan:** every component (`MapBulkEditToolbar.tsx`) and every `Studio.tsx` diff is full, real code — no "add appropriate handler" language. Task 2 Step 6 and Task 3 Step 6's tests have one instruction each ("match this file's existing convention for reading back state") flagged explicitly as a real repo-state dependency (the exact existing RTL assertion style in `Studio.test.tsx` for override round-trips wasn't independently re-derived line-by-line during planning), not a disguised gap.

**3. Type consistency:** `multiSelectedWarehouseIds`/`multiSelectedCustomerIds`/`onToggleWarehouseMultiSelect`/`onToggleCustomerMultiSelect` (Task 1's produced interface) are consumed by Task 2's `Studio.tsx` wiring with identical names. `MapBulkEditToolbarProps`'s `onSetWarehouseCapacity`/`onSetWarehouseStatus`/`onSetCustomerDemand`/`onSetCustomerStatus`/`onClearSelection` (Task 2) are extended, not renamed, by Task 3's `entityKind` addition.

**Explicit cross-plan dependency:** Task 3 requires `2026-07-24-transport-coal-overrides.md`'s Phase A + Phase B to have shipped first (its own Interfaces block states this). Tasks 1-2 have no dependency on either other plan and can execute first/independently.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-24-map-multiselect-bulk-edit.md`. All three plans requested are now written:
1. `docs/superpowers/plans/2026-07-24-studio-map-fixes.md` — issues 1, 4, 5 (map cut off, routes not rendering, hover tooltips)
2. `docs/superpowers/plans/2026-07-24-transport-coal-overrides.md` — issue 2/3 (real mineCapacities/stationDemands override support + import/export for transport-coal)
3. `docs/superpowers/plans/2026-07-24-map-multiselect-bulk-edit.md` — issue 6 (this plan)

No code has been touched — per your instruction, only these three plan documents were produced. Two more decisions remain before execution:

**1. Execution order.** Recommended: plan 1 first (smallest, no dependencies, fixes real user-visible bugs immediately), then plan 2 (the big lift), then plan 3 (depends on plan 2's Task 3 only — its Tasks 1-2 could actually run in parallel with plan 2).

**2. Execution approach per plan** — Subagent-Driven (fresh subagent per task, review between tasks) or Inline Execution (batch execution with checkpoints)? Given your standing instruction to leverage the `glm` subagent for executable work with you as decision-maker, Subagent-Driven (dispatching each task to `glm`, reviewing between tasks) matches how this session has been operating — confirm this is still your preference before execution begins.
