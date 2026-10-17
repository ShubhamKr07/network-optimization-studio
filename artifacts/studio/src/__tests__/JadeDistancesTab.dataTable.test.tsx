// SCU-2.P4.5 — JadeDistancesTab on the shared DataTable (spec B2.1–B2.4, D2).

import { useState, type ReactNode } from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useDisplayUnit } from "@/contexts/UnitContext";
import { AllProviders } from "@/__tests__/helpers/renderWithExportProvider";
import { JadeDistancesTab, type JadeDistanceOverride } from "@/components/workspace/tabs/JadeDistancesTab";

function Providers({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={client}>
      <AllProviders>{children}</AllProviders>
    </QueryClientProvider>
  );
}

const plantIds = ["plant-1", "plant-2"];
const warehouseIds = Array.from({ length: 20 }, (_, i) => `wh-${i + 1}`);
const customerIds = ["cust-1", "cust-2"];
// 40 plant→warehouse rows + 20 warehouse→customer rows = 60 → two pages.
// plant-9 is an unknown plant; the very last row is unsaved (Changed).
const rows: JadeDistanceOverride[] = [
  ...["plant-1", "plant-9"].flatMap(p =>
    warehouseIds.map((w, i) => ({
      leg: "plant_to_warehouse" as const,
      fromId: p,
      toId: w,
      distance: 200 + i,
      estimated: p === "plant-1" && i === 0,
    })),
  ),
  ...warehouseIds.map((w, i) => ({ leg: "warehouse_to_customer" as const, fromId: w, toId: "cust-1", distance: 50 + i })),
];
const saved = rows.slice(0, 59);

function renderTab(props: Partial<React.ComponentProps<typeof JadeDistancesTab>> = {}, extra?: ReactNode) {
  return render(
    <>
    {extra}
    <JadeDistancesTab
      distanceOverrides={rows}
      savedDistanceOverrides={saved}
      plantIds={plantIds}
      warehouseIds={warehouseIds}
      customerIds={customerIds}
      onChange={vi.fn()}
      canonicalUnit="mi"
      scenarioId={1}
      {...props}
    />
    </>,
    { wrapper: Providers },
  );
}

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

describe("JadeDistancesTab on DataTable (SCU-2.P4.5)", () => {
  it("emits every testid in the matrix map", () => {
    renderTab();
    const k = "plant_to_warehouse-plant-1-wh-1";
    for (const id of [
      "jade-distances-tab",
      "jadedistances-tab-toolbar",
      "button-import-legdistances",
      "button-download-legdistances",
      "button-filter-menu-trigger",
      `row-jadedistance-${k}`,
      `badge-leg-${k}`,
      `input-jadedistance-${k}`,
      `badge-jadedistance-estimated-${k}`,
      `cell-jadedistance-cost-${k}`,
      `button-remove-jadedistance-${k}`,
      "warning-unknown-from-plant_to_warehouse-plant-9-wh-1",
      "button-jadedistances-prev",
      "button-jadedistances-next",
      "jadedistances-page-indicator",
      "button-add-jadedistance-row",
    ]) {
      expect(screen.getByTestId(id)).toBeInTheDocument();
    }
    // the $/ton testid sits on the <td> itself (P1 adapter rule)
    expect(screen.getByTestId(`cell-jadedistance-cost-${k}`).tagName).toBe("TD");
    fireEvent.click(screen.getByTestId("button-jadedistances-next"));
    expect(screen.getByTestId("badge-jadedistance-changed-warehouse_to_customer-wh-20-cust-1")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("button-add-jadedistance-row"));
    expect(screen.getByTestId("select-new-jadedistance-leg")).toBeInTheDocument();
  });

  it("from/to keep their 'City, ST code' text filters; leg is a select", () => {
    renderTab();
    fireEvent.click(screen.getByTestId("button-filter-menu-trigger"));
    expect(screen.getByTestId("input-filter-from")).toBeInTheDocument();
    expect(screen.getByTestId("input-filter-to")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("checkbox-filter-leg-Warehouse → Customer"));
    expect(screen.queryByTestId("row-jadedistance-plant_to_warehouse-plant-1-wh-1")).toBeNull();
    expect(screen.getByTestId("row-jadedistance-warehouse_to_customer-wh-1-cust-1")).toBeInTheDocument();
  });

  it("numbers centred (Base, Override, $/ton)", () => {
    renderTab();
    const headers = within(screen.getByTestId("jade-distances-tab")).getAllByRole("columnheader");
    expect(headers.map(h => h.textContent)).toEqual(["Leg", "From", "To", "Base (mi)", "Override (mi)", "$/ton", "Min?", ""]);
    for (const i of [3, 4, 5]) expect(headers[i]).toHaveClass("text-center");
  });

  it("history read-only (D2)", () => {
    renderTab({ readOnly: true });
    const k = "plant_to_warehouse-plant-1-wh-1";
    expect(screen.getByTestId(`input-jadedistance-${k}`)).toBeDisabled();
    expect(screen.getByTestId(`button-remove-jadedistance-${k}`)).toBeDisabled();
    expect(screen.getByTestId("button-add-jadedistance-row")).toBeDisabled();
  });

  it("amber on the changed row, sky on the estimated row", () => {
    renderTab();
    expect(screen.getByTestId("row-jadedistance-plant_to_warehouse-plant-1-wh-1")).toHaveClass("bg-sky-50");
    fireEvent.click(screen.getByTestId("button-jadedistances-next"));
    expect(screen.getByTestId("row-jadedistance-warehouse_to_customer-wh-20-cust-1")).toHaveClass("bg-amber-50");
  });

  it("focus jump: clears the filter and moves to the target's page", () => {
    const { rerender } = renderTab();
    fireEvent.click(screen.getByTestId("button-filter-menu-trigger"));
    fireEvent.change(screen.getByTestId("input-filter-from"), { target: { value: "plant-1" } });
    rerender(
      <JadeDistancesTab
        distanceOverrides={rows}
        savedDistanceOverrides={saved}
        plantIds={plantIds}
        warehouseIds={warehouseIds}
        customerIds={customerIds}
        onChange={vi.fn()}
        canonicalUnit="mi"
        scenarioId={1}
        focusEntityId="cust-1"
      />,
    );
    expect(screen.getByTestId("input-filter-from")).toHaveValue("");
    // first cust-1 row is index 40 → page 1; the last (index 59) is on page 2
    expect(screen.getByTestId("jadedistances-page-indicator")).toHaveTextContent("Page 1 of 2");
    expect(screen.getByTestId("row-jadedistance-warehouse_to_customer-wh-1-cust-1")).toBeInTheDocument();
  });

  it("edit round-trip through a stateful parent", () => {
    function Parent() {
      const [r, setR] = useState(rows.slice(0, 3));
      return (
        <JadeDistancesTab
          distanceOverrides={r}
          savedDistanceOverrides={rows.slice(0, 3)}
          plantIds={plantIds}
          warehouseIds={warehouseIds}
          customerIds={customerIds}
          onChange={setR}
          canonicalUnit="mi"
        />
      );
    }
    render(<Parent />, { wrapper: Providers });
    const id = "input-jadedistance-plant_to_warehouse-plant-1-wh-2";
    fireEvent.change(screen.getByTestId(id), { target: { value: "333" } });
    fireEvent.blur(screen.getByTestId(id));
    expect(screen.getByTestId(id)).toHaveValue("333");
    expect(screen.getByTestId("badge-jadedistance-changed-plant_to_warehouse-plant-1-wh-2")).toBeInTheDocument();
  });
  it("an OPEN add-row form goes read-only when history browsing starts (D2, transient controls)", () => {
    const { rerender } = renderTab();
    fireEvent.click(screen.getByTestId("button-add-jadedistance-row"));
    for (const id of [
      "select-new-jadedistance-leg",
      "input-new-jadedistance-from",
      "input-new-jadedistance-to",
      "input-new-jadedistance-value",
      "button-add-jadedistance-confirm",
    ])
      expect(screen.getByTestId(id)).toBeEnabled();
    rerender(
      <JadeDistancesTab
        distanceOverrides={rows}
        savedDistanceOverrides={saved}
        plantIds={plantIds}
        warehouseIds={warehouseIds}
        customerIds={customerIds}
        onChange={vi.fn()}
        canonicalUnit="mi"
        scenarioId={1}
        readOnly
      />,
    );
    for (const id of [
      "select-new-jadedistance-leg",
      "input-new-jadedistance-from",
      "input-new-jadedistance-to",
      "input-new-jadedistance-value",
      "button-add-jadedistance-confirm",
    ]) {
      expect(screen.getByTestId(id)).toBeDisabled();
      expect(screen.getByTestId(id)).toHaveAttribute("title", "Read-only while browsing result history.");
    }
    expect(screen.getByTestId("button-add-jadedistance-cancel")).toBeEnabled();
  });

  // SCU-2.P4.5 (user decision 2026-10-17) — distance ranges reset on a km/mi toggle.
  it("the Override range filter resets when the display unit toggles", () => {
    function PrefToggle() {
      const u = useDisplayUnit();
      return <button data-testid="toggle-pref-km" onClick={() => u.setPref("km")}>km</button>;
    }
    window.localStorage.setItem("nos:display-unit-pref", "mi");
    try {
      renderTab({}, <PrefToggle />);
      const before = screen.getAllByTestId(/^row-jadedistance-/).length;
      fireEvent.click(screen.getByTestId("button-filter-menu-trigger"));
      fireEvent.change(screen.getByTestId("input-filter-override-max"), { target: { value: "55" } });
      expect(screen.getAllByTestId(/^row-jadedistance-/).length).toBeLessThan(before);
      fireEvent.click(screen.getByTestId("toggle-pref-km"));
      expect(screen.getAllByTestId(/^row-jadedistance-/).length).toBe(before);
    } finally {
      window.localStorage.removeItem("nos:display-unit-pref");
    }
  });
});
