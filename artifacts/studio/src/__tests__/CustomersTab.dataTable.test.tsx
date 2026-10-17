// SCU-2.P4.11 — Customers (scalar + JADE per-product) on the shared DataTable
// with the B2.9 demand cell (spec B2.1–B2.4, B2.8, B2.9, D2, D3 and the
// 2026-10-17 user decisions): grouped demand with a linked "Units" suffix and
// no aria-label; empty base demand clears the override; empty ADDED demand is
// not saved and reverts on blur; the Brazil lock is base-only; history
// read-only covers base, added and JADE rows; one filter menu over base +
// added; empty demand blocks the add-customer submit.

import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { AllProviders } from "@/__tests__/helpers/renderWithExportProvider";
import { CustomersTab, type AddedCustomer, type CustomerProductOverride } from "@/components/workspace/tabs/CustomersTab";
import type { CustomerOverride } from "@/components/tables/CustomerTable";

const customers = Array.from({ length: 10 }, (_, i) => ({
  id: `C${i + 1}`,
  city: `City${i + 1}`,
  state: "NY",
  lat: 40 + i,
  lng: -74 - i,
  demand: 1000 * (i + 1) + 234,
}));
const added: AddedCustomer[] = [
  { id: "ac-1", city: "Denver", state: "CO", lat: 39.7, lng: -105, demand: 5000, displayCode: "CS-CO-DENVER-01" },
];
const products = [
  { id: "product-1", name: "Copper" },
  { id: "product-2", name: "Aluminum" },
];
const jadeCustomers = customers.map(c => ({ ...c, demands: { "product-1": 1200, "product-2": 30 } }));
const jadeAdded: AddedCustomer[] = [{ ...added[0]!, demand: 50, demands: { "product-1": 40, "product-2": 10 } }];

const renderTab = (props: Partial<React.ComponentProps<typeof CustomersTab>> = {}) =>
  render(
    <CustomersTab
      customers={customers}
      overrides={[]}
      onChange={vi.fn()}
      scenarioId={1}
      addedCustomers={added}
      onAddedCustomersChange={vi.fn()}
      onDeleteCustomer={vi.fn()}
      {...props}
    />,
    { wrapper: AllProviders },
  );

const describedSuffix = (input: HTMLElement) => document.getElementById(input.getAttribute("aria-describedby") ?? "");

describe("CustomersTab on DataTable (SCU-2.P4.11)", () => {
  it("emits every testid in the matrix map (scalar)", () => {
    renderTab();
    for (const id of [
      "customers-tab",
      "customers-tab-toolbar",
      "button-import-customers",
      "button-download-customers",
      "button-filter-menu-trigger",
      "button-add-customer-row",
      "input-customer-demand-C1",
      "button-customer-C1-active",
      "button-customer-C1-excluded",
      "added-customers-section",
      "row-added-customer-ac-1",
      "input-added-customer-demand-ac-1",
      "button-delete-added-customer-ac-1",
    ]) {
      expect(screen.getByTestId(id)).toBeInTheDocument();
    }
    expect(screen.queryByTestId("customer-product-table")).toBeNull();
  });

  it("B2.9: demand is grouped, has a linked Units suffix and NO aria-label (base and added)", () => {
    renderTab();
    for (const id of ["input-customer-demand-C1", "input-added-customer-demand-ac-1"]) {
      const input = screen.getByTestId(id);
      expect(input).toHaveAttribute("type", "text");
      expect(input).not.toHaveAttribute("aria-label");
      expect(describedSuffix(input)).toHaveTextContent("Units");
    }
    expect(screen.getByTestId("input-customer-demand-C1")).toHaveValue("1,234");
    expect(screen.getByTestId("input-added-customer-demand-ac-1")).toHaveValue("5,000");
  });

  it("D3: emptying a BASE demand clears the override; the base value returns on blur", () => {
    function Parent() {
      const [o, setO] = useState<CustomerOverride[]>([{ id: "C1", demand: 777, status: "active" }]);
      return (
        <>
          <CustomersTab customers={customers} overrides={o} onChange={setO} />
          <output data-testid="overrides">{JSON.stringify(o)}</output>
        </>
      );
    }
    render(<Parent />, { wrapper: AllProviders });
    const input = screen.getByTestId("input-customer-demand-C1");
    expect(input).toHaveValue("777");
    fireEvent.change(input, { target: { value: "" } });
    expect(screen.getByTestId("overrides")).toHaveTextContent("[]");
    expect(screen.getByTestId("input-customer-demand-C1")).toHaveValue("");
    fireEvent.blur(screen.getByTestId("input-customer-demand-C1"));
    expect(screen.getByTestId("input-customer-demand-C1")).toHaveValue("1,234");
  });

  it("an emptied ADDED demand is NOT saved and reverts to the last valid value on blur", () => {
    const onAdded = vi.fn();
    renderTab({ onAddedCustomersChange: onAdded });
    const input = screen.getByTestId("input-added-customer-demand-ac-1");
    fireEvent.change(input, { target: { value: "" } });
    expect(onAdded).not.toHaveBeenCalled();
    expect(input).toHaveValue("");
    fireEvent.blur(input);
    expect(screen.getByTestId("input-added-customer-demand-ac-1")).toHaveValue("5,000");
  });

  it("a typed demand commits (decimals allowed, D3) through a stateful parent", () => {
    function Parent() {
      const [a, setA] = useState<AddedCustomer[]>(added);
      return (
        <CustomersTab
          customers={customers}
          overrides={[]}
          onChange={vi.fn()}
          addedCustomers={a}
          onAddedCustomersChange={setA}
          onDeleteCustomer={vi.fn()}
        />
      );
    }
    render(<Parent />, { wrapper: AllProviders });
    fireEvent.change(screen.getByTestId("input-added-customer-demand-ac-1"), { target: { value: "12345.5" } });
    expect(screen.getByTestId("input-added-customer-demand-ac-1")).toHaveValue("12,345.5");
  });

  it("Brazil (demandEditable false): BASE demand locked with the textbook title, ADDED demand editable", () => {
    renderTab({ demandEditable: false });
    expect(screen.getByTestId("input-customer-demand-C1")).toBeDisabled();
    expect(screen.getByTestId("input-customer-demand-C1")).toHaveAttribute(
      "title",
      "Demand for this row is fixed by the textbook dataset and can't be edited.",
    );
    expect(screen.getByTestId("button-customer-C1-excluded")).toBeEnabled();
    expect(screen.getByTestId("input-added-customer-demand-ac-1")).toBeEnabled();
  });

  it("history read-only (D2): base demand + status, added demand + delete, and the add trigger are disabled", () => {
    renderTab({ disabled: true });
    for (const id of [
      "input-customer-demand-C1",
      "button-customer-C1-excluded",
      "input-added-customer-demand-ac-1",
      "button-delete-added-customer-ac-1",
      "button-add-customer-row",
    ]) {
      expect(screen.getByTestId(id)).toBeDisabled();
    }
    expect(screen.getByTestId("input-customer-demand-C1")).toHaveAttribute("title", "Read-only while browsing result history.");
  });

  it("ONE filter menu over base + added (11 rows), Customers' state stays a text filter", () => {
    renderTab();
    expect(screen.getAllByTestId("button-filter-menu-trigger")).toHaveLength(1);
    fireEvent.click(screen.getByTestId("button-filter-menu-trigger"));
    expect(screen.getByTestId("input-filter-state")).toBeInTheDocument();
    fireEvent.change(screen.getByTestId("input-filter-city"), { target: { value: "denver" } });
    expect(screen.getByTestId("row-added-customer-ac-1")).toBeInTheDocument();
    expect(screen.queryByTestId("input-customer-demand-C1")).toBeNull();
  });

  it("the add modal blocks an EMPTY scalar demand; a filled one appends", () => {
    const onAdded = vi.fn();
    renderTab({ onAddedCustomersChange: onAdded });
    fireEvent.click(screen.getByTestId("button-add-customer-row"));
    const d = screen.getByTestId("create-entity-dialog");
    for (const [id, v] of [
      ["create-entity-city", "Akron"],
      ["create-entity-state", "OH"],
      ["create-entity-lat", "41.08"],
      ["create-entity-lng", "-81.52"],
    ] as const) {
      fireEvent.change(within(d).getByTestId(id), { target: { value: v } });
    }
    fireEvent.click(within(d).getByTestId("create-entity-submit"));
    expect(within(d).getByTestId("create-entity-error")).toHaveTextContent("Demand must be a number ≥ 0.");
    expect(onAdded).not.toHaveBeenCalled();
    fireEvent.change(within(d).getByTestId("create-entity-demand"), { target: { value: "205375" } });
    fireEvent.click(within(d).getByTestId("create-entity-submit"));
    expect(onAdded).toHaveBeenCalledTimes(1);
    expect((onAdded.mock.calls[0]![0] as AddedCustomer[])[1]).toMatchObject({
      city: "Akron",
      demand: 205375,
      displayCode: "CS-OH-AKRON-01",
    });
  });
});

describe("CustomersTab JADE per-product on DataTable (SCU-2.P4.11)", () => {
  const renderJade = (props: Partial<React.ComponentProps<typeof CustomersTab>> = {}) =>
    render(
      <CustomersTab
        customers={jadeCustomers}
        overrides={[]}
        onChange={vi.fn()}
        products={products}
        productOverrides={[]}
        onProductOverridesChange={vi.fn()}
        addedCustomers={jadeAdded}
        onAddedCustomersChange={vi.fn()}
        onDeleteCustomer={vi.fn()}
        {...props}
      />,
      { wrapper: AllProviders },
    );

  it("emits the JADE testids: wrapper, per-product base and added demand, status", () => {
    renderJade();
    for (const id of [
      "customer-product-table",
      "input-customer-demand-C1-product-1",
      "input-customer-demand-C1-product-2",
      "button-customer-C1-excluded",
      "input-added-customer-demand-ac-1-product-1",
      "row-added-customer-ac-1",
    ]) {
      expect(screen.getByTestId(id)).toBeInTheDocument();
    }
    expect(screen.getByTestId("input-customer-demand-C1-product-1")).toHaveValue("1,200");
    expect(screen.getByTestId("input-customer-demand-C1-product-1")).not.toHaveAttribute("aria-label");
    expect(describedSuffix(screen.getByTestId("input-customer-demand-C1-product-1"))).toHaveTextContent("Units");
    // the base table's headers: one demand column per product, State always shown
    const baseHeaders = within(screen.getByTestId("customer-product-table"))
      .getAllByRole("columnheader")
      .map(h => h.textContent);
    expect(baseHeaders).toEqual(["ID", "City", "State", "Latitude", "Longitude", "Copper", "Aluminum", "Status"]);
  });

  it("history read-only (D2) now covers JADE base AND added per-product demand + status (was live)", () => {
    renderJade({ disabled: true });
    for (const id of [
      "input-customer-demand-C1-product-1",
      "button-customer-C1-excluded",
      "input-added-customer-demand-ac-1-product-2",
      "button-delete-added-customer-ac-1",
    ]) {
      expect(screen.getByTestId(id)).toBeDisabled();
    }
  });

  it("emptying a JADE base product demand deletes that product's override (D3)", () => {
    function Parent() {
      const [o, setO] = useState<CustomerProductOverride[]>([
        { id: "C1", status: "active", demands: { "product-1": 5, "product-2": 6 } },
      ]);
      return (
        <>
          <CustomersTab
            customers={jadeCustomers}
            overrides={[]}
            onChange={vi.fn()}
            products={products}
            productOverrides={o}
            onProductOverridesChange={setO}
          />
          <output data-testid="overrides">{JSON.stringify(o)}</output>
        </>
      );
    }
    render(<Parent />, { wrapper: AllProviders });
    fireEvent.change(screen.getByTestId("input-customer-demand-C1-product-1"), { target: { value: "" } });
    expect(JSON.parse(screen.getByTestId("overrides").textContent ?? "")).toEqual([
      { id: "C1", status: "active", demands: { "product-2": 6 } },
    ]);
    fireEvent.blur(screen.getByTestId("input-customer-demand-C1-product-1"));
    expect(screen.getByTestId("input-customer-demand-C1-product-1")).toHaveValue("1,200");
  });

  it("an emptied JADE ADDED product demand is not saved and reverts on blur", () => {
    const onAdded = vi.fn();
    renderJade({ onAddedCustomersChange: onAdded });
    const input = screen.getByTestId("input-added-customer-demand-ac-1-product-1");
    fireEvent.change(input, { target: { value: "" } });
    expect(onAdded).not.toHaveBeenCalled();
    fireEvent.blur(input);
    expect(screen.getByTestId("input-added-customer-demand-ac-1-product-1")).toHaveValue("40");
  });
  it("an OPEN +Add modal goes read-only when history browsing starts (D2, transient controls)", () => {
    const { rerender } = renderTab();
    fireEvent.click(screen.getByTestId("button-add-customer-row"));
    const fields = [
      "create-entity-city",
      "create-entity-state",
      "create-entity-lat",
      "create-entity-lng",
      "create-entity-display-code",
      "create-entity-demand",
      "create-entity-submit",
    ];
    for (const id of fields) expect(screen.getByTestId(id)).toBeEnabled();
    rerender(
      <CustomersTab
        customers={customers}
        overrides={[]}
        onChange={vi.fn()}
        scenarioId={1}
        addedCustomers={added}
        onAddedCustomersChange={vi.fn()}
        onDeleteCustomer={vi.fn()}
        disabled
      />,
    );
    for (const id of fields) expect(screen.getByTestId(id)).toBeDisabled();
    expect(screen.getByTestId("create-entity-submit")).toHaveAttribute("title", "Read-only while browsing result history.");
    expect(screen.getByTestId("create-entity-cancel")).toBeEnabled();
  });
});
