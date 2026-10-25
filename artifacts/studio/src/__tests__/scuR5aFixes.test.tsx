// SCU-2.R5a — Phase 4 review findings folded into the studio input tables:
// D1 integer demand (max-coverage-us), D2 centred number inputs, D5 draft vs
// clamped value, item 6 display-code filters, item 7 focus token stability,
// and the manifest-derived integer-demand helper.

import { useState, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AllProviders } from "@/__tests__/helpers/renderWithExportProvider";
import { filterText } from "@/__tests__/helpers/inputTable";
import { DemandCell, DraftNumberInput } from "@/components/data-table/entityCells";
import type { CustomerOverride } from "@/components/tables/CustomerTable";
import { CustomersTab, type AddedCustomer } from "@/components/workspace/tabs/CustomersTab";
import { DistancesTab, type DistanceOverride } from "@/components/workspace/tabs/DistancesTab";
import { LaneCostsTab } from "@/components/workspace/tabs/LaneCostsTab";
import { LegDistancesTab } from "@/components/workspace/tabs/LegDistancesTab";
import { hasIntegerCustomerDemand } from "@/lib/integerDemand";

function Providers({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={client}>
      <AllProviders>{children}</AllProviders>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

describe("hasIntegerCustomerDemand (D1)", () => {
  it("reads the manifest's addedCustomers demand type", () => {
    const schema = (type: unknown) => ({ properties: { addedCustomers: { items: { properties: { demand: { type } } } } } });
    expect(hasIntegerCustomerDemand(schema("integer"))).toBe(true);
    expect(hasIntegerCustomerDemand(schema("number"))).toBe(false);
    expect(hasIntegerCustomerDemand({})).toBe(false);
    expect(hasIntegerCustomerDemand(undefined)).toBe(false);
  });
});

describe("integer customer demand (D1, max-coverage-us)", () => {
  const customers = [{ id: "C1", city: "A", state: "NY", lat: 40, lng: -74, demand: 1000 }];
  const added: AddedCustomer[] = [{ id: "ac-1", city: "Denver", state: "CO", lat: 39.7, lng: -105, demand: 5000, displayCode: "CS-1" }];
  function Parent({ integerDemand }: { integerDemand: boolean }) {
    const [o, setO] = useState<CustomerOverride[]>([]);
    const [a, setA] = useState<AddedCustomer[]>(added);
    return (
      <CustomersTab
        customers={customers}
        overrides={o}
        onChange={setO}
        scenarioId={1}
        addedCustomers={a}
        onAddedCustomersChange={setA}
        onDeleteCustomer={vi.fn()}
        integerDemand={integerDemand}
      />
    );
  }
  const renderTab = (integerDemand: boolean) => render(<Parent integerDemand={integerDemand} />, { wrapper: AllProviders });

  it.each([
    ["input-customer-demand-C1", "1,000"],
    ["input-added-customer-demand-ac-1", "5,000"],
  ])("%s rejects a decimal point", (id, before) => {
    renderTab(true);
    const input = screen.getByTestId(id) as HTMLInputElement;
    expect(input.inputMode).toBe("numeric");
    fireEvent.change(input, { target: { value: "12.5" } });
    expect(input.value).toBe(before);
  });

  it.each(["input-customer-demand-C1", "input-added-customer-demand-ac-1"])("decimal models still accept a decimal point (%s)", id => {
    renderTab(false);
    const input = screen.getByTestId(id) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "12.5" } });
    expect(input.value).toBe("12.5");
  });

  it("the Add dialog demand field is integer too", () => {
    renderTab(true);
    fireEvent.click(screen.getByTestId("button-add-customer-row"));
    const input = screen.getByTestId("create-entity-demand") as HTMLInputElement;
    expect(input.inputMode).toBe("numeric");
    fireEvent.change(input, { target: { value: "7.5" } });
    expect(input.value).not.toContain(".");
  });
});

describe("number inputs in table cells are centred (D2)", () => {
  it("DraftNumberInput and DemandCell", () => {
    render(
      <>
        <DraftNumberInput value={1} parse={Number} onCommit={() => {}} disabled={false} testId="draft" />
        <DemandCell value={1} onCommit={() => {}} clearCommits disabled={false} testId="demand" />
      </>,
    );
    expect(screen.getByTestId("draft")).toHaveClass("text-center");
    expect(screen.getByTestId("demand")).toHaveClass("text-center");
  });

  it("distance / lane-cost value cells and the Distances override cell", () => {
    render(
      <>
        <LaneCostsTab laneCostOverrides={[{ fromId: "MN01", toId: "ST1", cost: 5 }]} savedLaneCostOverrides={[]} mineIds={["MN01"]} stationIds={["ST1"]} onChange={vi.fn()} canonicalUnit="mi" scenarioId={1} />
        <DistancesTab distanceOverrides={[{ fromId: "WH01", toId: "C1", distance: 5 }]} savedDistanceOverrides={[]} warehouseIds={["WH01"]} customerIds={["C1"]} onChange={vi.fn()} canonicalUnit="mi" scenarioId={1} />
      </>,
      { wrapper: Providers },
    );
    expect(screen.getByTestId("input-lanecost-MN01-ST1")).toHaveClass("text-center");
    expect(screen.getByTestId("input-distance-WH01-C1")).toHaveClass("text-center");
  });
});

describe("DraftNumberInput shows the saved (clamped) value (D5)", () => {
  it("typing -5 into a clamping parse shows 0, not -5", () => {
    function Harness() {
      const [v, setV] = useState<number | null>(null);
      return (
        <DraftNumberInput
          value={v}
          parse={raw => (raw === "" ? null : Math.max(0, parseFloat(raw) || 0))}
          onCommit={setV}
          disabled={false}
          testId="cap"
        />
      );
    }
    render(<Harness />);
    fireEvent.change(screen.getByTestId("cap"), { target: { value: "-5" } });
    expect(screen.getByTestId("cap")).toHaveValue(0);
  });
});

describe("From/To filters match the display code (item 6)", () => {
  it("LaneCostsTab", () => {
    render(
      <LaneCostsTab
        laneCostOverrides={[
          ...Array.from({ length: 11 }, (_, i) => ({ fromId: "am-1", toId: `ST${i + 1}`, cost: 5 })),
          { fromId: "MN01", toId: "ST1", cost: 6 },
        ]}
        savedLaneCostOverrides={[]}
        mineIds={["am-1", "MN01"]}
        stationIds={["ST1"]}
        displayCodeById={{ "am-1": "MN-ADDED-01" }}
        onChange={vi.fn()}
        canonicalUnit="mi"
        scenarioId={1}
      />,
      { wrapper: Providers },
    );
    filterText("from", "MN-ADDED-01");
    expect(screen.getByTestId("row-lanecost-am-1-ST1")).toBeInTheDocument();
    expect(screen.queryByTestId("row-lanecost-MN01-ST1")).toBeNull();
  });

  it("LegDistancesTab", () => {
    render(
      <LegDistancesTab
        distanceOverrides={[
          ...Array.from({ length: 11 }, (_, i) => ({ fromId: "am-1", toId: `ST${i + 1}`, distance: 5 })),
          { fromId: "MN01", toId: "ST1", distance: 6 },
        ]}
        savedDistanceOverrides={[]}
        mineIds={["am-1", "MN01"]}
        refineryIds={["ST1"]}
        customerIds={[]}
        displayCodeById={{ "am-1": "MN-ADDED-01" }}
        onChange={vi.fn()}
        canonicalUnit="mi"
        scenarioId={1}
      />,
      { wrapper: Providers },
    );
    filterText("from", "MN-ADDED-01");
    expect(screen.getByTestId("row-legdistance-am-1-ST1")).toBeInTheDocument();
    expect(screen.queryByTestId("row-legdistance-MN01-ST1")).toBeNull();
  });
});

describe("focus jump is not re-fired by a row add/delete (item 7)", () => {
  it("DistancesTab keeps the user's filter after a later row is added", () => {
    const rows: DistanceOverride[] = ["WH01", "WH02", "WH03", "WH04"].flatMap(w =>
      [1, 2, 3].map(c => ({ fromId: w, toId: `C${c}`, distance: 100 + c })),
    );
    const props = {
      savedDistanceOverrides: rows,
      warehouseIds: ["WH01", "WH02", "WH03", "WH04"],
      customerIds: ["C1", "C2", "C3", "C4"],
      onChange: vi.fn(),
      canonicalUnit: "mi" as const,
      scenarioId: 1,
      focusEntityId: "WH03",
    };
    const { rerender } = render(<DistancesTab distanceOverrides={rows} {...props} />, { wrapper: Providers });
    filterText("from", "WH01");
    expect(screen.getByTestId("input-filter-from")).toHaveValue("WH01");
    rerender(<DistancesTab distanceOverrides={[...rows, { fromId: "WH01", toId: "C4", distance: 9 }]} {...props} />);
    expect(screen.getByTestId("input-filter-from")).toHaveValue("WH01");
  });
});
