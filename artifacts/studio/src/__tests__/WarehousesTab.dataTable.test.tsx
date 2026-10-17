// SCU-2.P4.10 — Warehouses (and Refineries) on the shared DataTable (spec
// B2.1–B2.4, B2.8, D2, D4): base + added sections under one toolbar, ONE
// filter menu over both, history read-only on base AND added controls, the
// "+ Add warehouse" modal, and the refinery trigger keeping its warehouse id.

import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { AllProviders } from "@/__tests__/helpers/renderWithExportProvider";
import { WarehousesTab, type AddedWarehouse } from "@/components/workspace/tabs/WarehousesTab";
import type { WarehouseOverride } from "@/components/tables/WarehouseTable";

const base = Array.from({ length: 10 }, (_, i) => ({
  id: `WH${i + 1}`,
  city: `City${i + 1}`,
  state: i < 5 ? "IL" : "OH",
  lat: 41 + i,
  lng: -87 - i,
}));
const added: AddedWarehouse[] = [
  {
    id: "aw-1",
    city: "Denver",
    state: "CO",
    lat: 39.7,
    lng: -105,
    capacity: 500,
    status: "active",
    displayCode: "WH-CO-DENVER-01",
  },
];

function renderTab(props: Partial<React.ComponentProps<typeof WarehousesTab>> = {}) {
  return render(
    <WarehousesTab
      warehouses={base}
      overrides={[{ id: "WH2", status: "forced_open" }]}
      capacityMode="per_wh"
      onChange={vi.fn()}
      scenarioId={1}
      addedWarehouses={added}
      onAddedWarehousesChange={vi.fn()}
      onDeleteWarehouse={vi.fn()}
      {...props}
    />,
    { wrapper: AllProviders },
  );
}

describe("WarehousesTab on DataTable (SCU-2.P4.10)", () => {
  it("emits every testid in the matrix map (base + added, toolbar, menus)", () => {
    renderTab();
    for (const id of [
      "warehouses-tab",
      "warehouses-tab-toolbar",
      "button-import-warehouses",
      "button-download-warehouses",
      "button-filter-menu-trigger",
      "button-add-warehouse-row",
      "input-wh-capacity-WH1",
      "button-wh-WH1-active",
      "button-wh-WH1-forced_open",
      "button-wh-WH1-inactive",
      "added-warehouses-section",
      "row-added-warehouse-aw-1",
      "input-added-wh-capacity-aw-1",
      "button-added-wh-aw-1-inactive",
      "button-delete-added-warehouse-aw-1",
    ]) {
      expect(screen.getByTestId(id)).toBeInTheDocument();
    }
    fireEvent.click(screen.getByTestId("button-download-warehouses"));
    expect(screen.getByTestId("button-export-warehouses-csv")).toBeInTheDocument();
    expect(screen.getByTestId("button-export-warehouses-json")).toBeInTheDocument();
  });

  it("base rows carry NO row testid; added rows do (matrix: base <tr> has none)", () => {
    renderTab();
    const baseRow = screen.getByTestId("input-wh-capacity-WH1").closest("tr")!;
    expect(baseRow).not.toHaveAttribute("data-testid");
    expect(screen.getByTestId("row-added-warehouse-aw-1").tagName).toBe("TR");
  });

  it("ONE filter menu over base + added rows (11 rows ≥ threshold), status option = presentation label", () => {
    renderTab();
    expect(screen.getAllByTestId("button-filter-menu-trigger")).toHaveLength(1);
    fireEvent.click(screen.getByTestId("button-filter-menu-trigger"));
    expect(screen.getByTestId("text-filter-count")).toHaveTextContent("11 of 11");
    fireEvent.click(screen.getByTestId("checkbox-filter-status-Fixed-Open"));
    expect(screen.getByTestId("text-filter-count")).toHaveTextContent("1 of 11");
    expect(screen.getByTestId("button-wh-WH2-forced_open")).toBeInTheDocument();
    expect(screen.queryByTestId("row-added-warehouse-aw-1")).toBeNull();
    fireEvent.click(screen.getByTestId("button-clear-all-filters"));
    fireEvent.change(screen.getByTestId("input-filter-city"), { target: { value: "denver" } });
    expect(screen.getByTestId("row-added-warehouse-aw-1")).toBeInTheDocument();
    expect(screen.queryByTestId("button-wh-WH1-active")).toBeNull();
  });

  it("numbers centred (lat, lng, capacity); header texts unchanged; JADE-like capacityMode none drops Capacity", () => {
    const { unmount } = renderTab();
    const headers = screen.getAllByRole("columnheader").map(h => h.textContent);
    expect(headers.slice(0, 7)).toEqual(["ID", "City", "State", "Latitude", "Longitude", "Capacity", "Status"]);
    expect(screen.getAllByRole("columnheader")[3]).toHaveClass("text-center");
    unmount();
    renderTab({ capacityMode: "none" });
    expect(screen.getAllByRole("columnheader").map(h => h.textContent)).not.toContain("Capacity");
  });

  it("history read-only (D2): base AND added capacity, status, delete and the add trigger are disabled", () => {
    renderTab({ disabled: true });
    for (const id of [
      "input-wh-capacity-WH1",
      "button-wh-WH1-forced_open",
      "input-added-wh-capacity-aw-1",
      "button-added-wh-aw-1-forced_open",
      "button-delete-added-warehouse-aw-1",
      "button-add-warehouse-row",
    ]) {
      expect(screen.getByTestId(id)).toBeDisabled();
    }
  });

  it("no added section (and no add trigger) when the added capability is not wired (delivery)", () => {
    renderTab({ addedWarehouses: undefined, onAddedWarehousesChange: undefined, onDeleteWarehouse: undefined });
    expect(screen.queryByTestId("added-warehouses-section")).toBeNull();
    expect(screen.queryByTestId("button-add-warehouse-row")).toBeNull();
  });

  it("+ Add warehouse opens the modal; submit appends through onAddedWarehousesChange", () => {
    const onAdded = vi.fn();
    renderTab({ onAddedWarehousesChange: onAdded });
    fireEvent.click(screen.getByTestId("button-add-warehouse-row"));
    const dialog = screen.getByTestId("create-entity-dialog");
    fireEvent.change(within(dialog).getByTestId("create-entity-city"), { target: { value: "Akron" } });
    fireEvent.change(within(dialog).getByTestId("create-entity-state"), { target: { value: "OH" } });
    fireEvent.change(within(dialog).getByTestId("create-entity-lat"), { target: { value: "41.08" } });
    fireEvent.change(within(dialog).getByTestId("create-entity-lng"), { target: { value: "-81.52" } });
    fireEvent.change(within(dialog).getByTestId("create-entity-capacity"), { target: { value: "900" } });
    fireEvent.click(within(dialog).getByTestId("create-entity-submit"));
    expect(onAdded).toHaveBeenCalledTimes(1);
    const next = onAdded.mock.calls[0]![0] as AddedWarehouse[];
    expect(next).toHaveLength(2);
    expect(next[1]).toMatchObject({
      city: "Akron",
      state: "OH",
      lat: 41.08,
      lng: -81.52,
      capacity: 900,
      status: "active",
      displayCode: "WH-OH-AKRON-01",
    });
    expect(screen.queryByTestId("create-entity-dialog")).toBeNull();
  });

  it("Refineries: trigger keeps button-add-warehouse-row (D4), label and modal say refinery, no capacity", () => {
    renderTab({ entity: "refineries", capacityMode: "none" });
    expect(screen.getByTestId("refineries-tab-toolbar")).toBeInTheDocument();
    expect(screen.getByTestId("button-add-warehouse-row")).toHaveTextContent("+ Add refinery");
    fireEvent.click(screen.getByTestId("button-add-warehouse-row"));
    expect(screen.getByTestId("create-entity-dialog")).toHaveTextContent("New refinery");
    expect(screen.queryByTestId("create-entity-capacity")).toBeNull();
  });

  it("edit round-trip: a base status click and an added capacity edit reach their parents", () => {
    function Parent() {
      const [o, setO] = useState<WarehouseOverride[]>([]);
      const [a, setA] = useState<AddedWarehouse[]>(added);
      return (
        <WarehousesTab
          warehouses={base}
          overrides={o}
          capacityMode="per_wh"
          onChange={setO}
          addedWarehouses={a}
          onAddedWarehousesChange={setA}
          onDeleteWarehouse={vi.fn()}
        />
      );
    }
    render(<Parent />, { wrapper: AllProviders });
    fireEvent.click(screen.getByTestId("button-wh-WH3-inactive"));
    expect(screen.getByTestId("button-wh-WH3-inactive")).toHaveClass("bg-destructive");
    fireEvent.change(screen.getByTestId("input-added-wh-capacity-aw-1"), { target: { value: "750" } });
    expect(screen.getByTestId("input-added-wh-capacity-aw-1")).toHaveValue(750);
  });
  it("an OPEN +Add modal goes read-only when history browsing starts (D2, transient controls)", () => {
    const { rerender } = renderTab();
    fireEvent.click(screen.getByTestId("button-add-warehouse-row"));
    const fields = [
      "create-entity-city",
      "create-entity-state",
      "create-entity-lat",
      "create-entity-lng",
      "create-entity-display-code",
      "create-entity-capacity",
      "create-entity-status-forced_open",
      "create-entity-submit",
    ];
    for (const id of fields) expect(screen.getByTestId(id)).toBeEnabled();
    rerender(
      <WarehousesTab
        warehouses={base}
        overrides={[{ id: "WH2", status: "forced_open" }]}
        capacityMode="per_wh"
        onChange={vi.fn()}
        scenarioId={1}
        addedWarehouses={added}
        onAddedWarehousesChange={vi.fn()}
        onDeleteWarehouse={vi.fn()}
        disabled
      />,
    );
    for (const id of fields) expect(screen.getByTestId(id)).toBeDisabled();
    expect(screen.getByTestId("create-entity-submit")).toHaveAttribute("title", "Read-only while browsing result history.");
    expect(screen.getByTestId("create-entity-cancel")).toBeEnabled();
  });
});
