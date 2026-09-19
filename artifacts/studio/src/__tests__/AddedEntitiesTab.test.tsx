import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AddedEntitiesTab } from "@/components/workspace/tabs/AddedEntitiesTab";
import { WarehousesTab } from "@/components/workspace/tabs/WarehousesTab";
import { CustomersTab } from "@/components/workspace/tabs/CustomersTab";

const warehouses = [{ id: "CHI", city: "Chicago", state: "IL", lat: 41.88, lng: -87.62 }];
const customers = [{ id: "C1", city: "New York", state: "NY", lat: 40.71, lng: -74.0, demand: 100 }];

// T9 (Workspace fixups bundle, item 4 part B) — AddedEntitiesTab is a
// generic segmented-tab shell (mirrors JadeFlowsTab.tsx's inner-tab
// pattern). It has zero knowledge of which base tab/model/entity is behind
// any sub-tab — the caller supplies fully-wired content per sub-tab. These
// tests exercise a 2-sub-tab set built from the real WarehousesTab/
// CustomersTab base tabs (rendered `showBaseTable={false}`, exactly as the
// real Workspace.tsx/INT call site will do), proving:
//   1. both inner tabs render (segmented control shows both labels)
//   2. switching inner tabs swaps the base tab, and only the added-only
//      region (no base table/toolbar) ever renders
//   3. add/delete callbacks fire through to the correct handler per sub-tab

function buildSubTabs(opts: {
  onAddedWarehousesChange: (next: unknown[]) => void;
  onDeleteWarehouse: (id: string) => void;
  onAddedCustomersChange: (next: unknown[]) => void;
  onDeleteCustomer: (id: string) => void;
  addedWarehouses?: { id: string; city: string; state: string; lat: number; lng: number; capacity: number | null; status: "active" | "forced_open" | "inactive" }[];
  addedCustomers?: { id: string; city: string; state: string; lat: number; lng: number; demand: number }[];
}) {
  return [
    {
      id: "warehouses",
      label: "Warehouses",
      content: (
        <WarehousesTab
          warehouses={warehouses}
          overrides={[]}
          capacityMode="none"
          onChange={vi.fn()}
          showBaseTable={false}
          addedWarehouses={opts.addedWarehouses ?? []}
          onAddedWarehousesChange={opts.onAddedWarehousesChange}
          onDeleteWarehouse={opts.onDeleteWarehouse}
        />
      ),
    },
    {
      id: "customers",
      label: "Customers",
      content: (
        <CustomersTab
          customers={customers}
          overrides={[]}
          onChange={vi.fn()}
          showBaseTable={false}
          addedCustomers={opts.addedCustomers ?? []}
          onAddedCustomersChange={opts.onAddedCustomersChange}
          onDeleteCustomer={opts.onDeleteCustomer}
        />
      ),
    },
  ];
}

describe("AddedEntitiesTab", () => {
  it("renders an empty state when no sub-tabs are supplied", () => {
    render(<AddedEntitiesTab subTabs={[]} />);
    expect(screen.getByTestId("added-entities-empty")).toBeInTheDocument();
    expect(screen.queryByTestId("added-entities-tab")).not.toBeInTheDocument();
  });

  it("given a 2-sub-tab set, both inner tabs render on the segmented control", () => {
    const subTabs = buildSubTabs({
      onAddedWarehousesChange: vi.fn(),
      onDeleteWarehouse: vi.fn(),
      onAddedCustomersChange: vi.fn(),
      onDeleteCustomer: vi.fn(),
    });
    render(<AddedEntitiesTab subTabs={subTabs} />);
    expect(screen.getByTestId("button-added-entities-inner-warehouses")).toHaveTextContent("Warehouses");
    expect(screen.getByTestId("button-added-entities-inner-customers")).toHaveTextContent("Customers");
  });

  it("defaults to the first sub-tab active", () => {
    const subTabs = buildSubTabs({
      onAddedWarehousesChange: vi.fn(),
      onDeleteWarehouse: vi.fn(),
      onAddedCustomersChange: vi.fn(),
      onDeleteCustomer: vi.fn(),
    });
    render(<AddedEntitiesTab subTabs={subTabs} />);
    expect(screen.getByTestId("button-added-entities-inner-warehouses")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("button-added-entities-inner-customers")).toHaveAttribute("aria-pressed", "false");
    // The Warehouses base tab's added-only region is present...
    expect(screen.getByTestId("added-warehouses-section")).toBeInTheDocument();
    // ...and the Customers base tab's added-only region is NOT mounted yet.
    expect(screen.queryByTestId("added-customers-section")).not.toBeInTheDocument();
  });

  it("switching inner tabs swaps the base tab (added-only, no base table/toolbar in either)", async () => {
    const subTabs = buildSubTabs({
      onAddedWarehousesChange: vi.fn(),
      onDeleteWarehouse: vi.fn(),
      onAddedCustomersChange: vi.fn(),
      onDeleteCustomer: vi.fn(),
    });
    render(<AddedEntitiesTab subTabs={subTabs} />);

    // Warehouses sub-tab active: no base warehouses table/toolbar.
    expect(screen.queryByTestId("warehouses-tab")).not.toBeInTheDocument();
    expect(screen.queryByTestId("warehouses-tab-toolbar")).not.toBeInTheDocument();
    expect(screen.queryByText("CHI")).not.toBeInTheDocument();

    await userEvent.click(screen.getByTestId("button-added-entities-inner-customers"));

    expect(screen.getByTestId("button-added-entities-inner-customers")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("button-added-entities-inner-warehouses")).toHaveAttribute("aria-pressed", "false");
    // Customers sub-tab now active: its added-only region shows, warehouses' doesn't.
    expect(screen.getByTestId("added-customers-section")).toBeInTheDocument();
    expect(screen.queryByTestId("added-warehouses-section")).not.toBeInTheDocument();
    // No base customers table/toolbar either.
    expect(screen.queryByTestId("customers-tab")).not.toBeInTheDocument();
    expect(screen.queryByTestId("customers-tab-toolbar")).not.toBeInTheDocument();
    expect(screen.queryByText("New York")).not.toBeInTheDocument();
  });

  it("add callback fires through to the correct handler on the active (warehouses) sub-tab", async () => {
    const onAddedWarehousesChange = vi.fn();
    const subTabs = buildSubTabs({
      onAddedWarehousesChange,
      onDeleteWarehouse: vi.fn(),
      onAddedCustomersChange: vi.fn(),
      onDeleteCustomer: vi.fn(),
    });
    render(<AddedEntitiesTab subTabs={subTabs} />);

    await userEvent.click(screen.getByTestId("button-add-warehouse-row"));
    await userEvent.type(screen.getByTestId("input-new-warehouse-city"), "Denver");
    await userEvent.type(screen.getByTestId("input-new-warehouse-state"), "CO");
    await userEvent.type(screen.getByTestId("input-new-warehouse-lat"), "39.74");
    await userEvent.type(screen.getByTestId("input-new-warehouse-lng"), "-104.99");
    await userEvent.click(screen.getByTestId("button-add-warehouse-confirm"));

    expect(onAddedWarehousesChange).toHaveBeenCalledTimes(1);
    const [added] = onAddedWarehousesChange.mock.calls[0][0];
    expect(added).toMatchObject({ city: "Denver", state: "CO", lat: 39.74, lng: -104.99 });
  });

  it("delete callback fires through to the correct handler on the active (warehouses) sub-tab", async () => {
    const onDeleteWarehouse = vi.fn();
    const subTabs = buildSubTabs({
      onAddedWarehousesChange: vi.fn(),
      onDeleteWarehouse,
      onAddedCustomersChange: vi.fn(),
      onDeleteCustomer: vi.fn(),
      addedWarehouses: [{ id: "NEWWH", city: "Denver", state: "CO", lat: 39.74, lng: -104.99, capacity: null, status: "active" }],
    });
    render(<AddedEntitiesTab subTabs={subTabs} />);

    expect(screen.getByTestId("row-added-warehouse-NEWWH")).toBeInTheDocument();
    await userEvent.click(screen.getByTestId("button-delete-added-warehouse-NEWWH"));
    expect(onDeleteWarehouse).toHaveBeenCalledWith("NEWWH");
  });

  it("add/delete callbacks fire through to the correct handler after switching to the customers sub-tab (not the warehouses handlers)", async () => {
    const onAddedWarehousesChange = vi.fn();
    const onDeleteWarehouse = vi.fn();
    const onAddedCustomersChange = vi.fn();
    const onDeleteCustomer = vi.fn();
    const subTabs = buildSubTabs({
      onAddedWarehousesChange,
      onDeleteWarehouse,
      onAddedCustomersChange,
      onDeleteCustomer,
      addedCustomers: [{ id: "AC1", city: "Denver", state: "CO", lat: 39.74, lng: -104.99, demand: 500 }],
    });
    render(<AddedEntitiesTab subTabs={subTabs} />);

    await userEvent.click(screen.getByTestId("button-added-entities-inner-customers"));

    // Delete an existing added customer.
    await userEvent.click(screen.getByTestId("button-delete-added-customer-AC1"));
    expect(onDeleteCustomer).toHaveBeenCalledWith("AC1");
    expect(onDeleteWarehouse).not.toHaveBeenCalled();

    // Add a new customer row.
    await userEvent.click(screen.getByTestId("button-add-customer-row"));
    await userEvent.type(screen.getByTestId("input-new-customer-city"), "Miami");
    await userEvent.type(screen.getByTestId("input-new-customer-state"), "FL");
    await userEvent.type(screen.getByTestId("input-new-customer-lat"), "25.76");
    await userEvent.type(screen.getByTestId("input-new-customer-lng"), "-80.19");
    await userEvent.type(screen.getByTestId("input-new-customer-demand"), "42");
    await userEvent.click(screen.getByTestId("button-add-customer-confirm"));

    expect(onAddedCustomersChange).toHaveBeenCalledTimes(1);
    expect(onAddedWarehousesChange).not.toHaveBeenCalled();
  });
});
