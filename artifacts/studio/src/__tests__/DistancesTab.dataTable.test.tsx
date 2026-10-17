// SCU-2.P4.3 — DistancesTab on the shared DataTable (spec B2.1–B2.4, D2).
// Pins: every testid in the matrix map is still emitted (plus the new menu
// triggers), history read-only reaches every control, the amber changed
// row, numbers centred, the pager only above 50 rows, and one edit
// round-trip through a stateful parent.

import { useState } from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { useDisplayUnit } from "@/contexts/UnitContext";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { AllProviders } from "@/__tests__/helpers/renderWithExportProvider";
import { DistancesTab, type DistanceOverride } from "@/components/workspace/tabs/DistancesTab";

function Providers({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={client}>
      <AllProviders>{children}</AllProviders>
    </QueryClientProvider>
  );
}

// 3 warehouses × 20 customers = 60 rows → two pages. WH03 and C020 are
// unknown ids (warning icons); WH02→C005 is estimated; the last two rows
// differ from the saved state (Changed, amber).
const current: DistanceOverride[] = [];
for (const w of ["WH01", "WH02", "WH03"]) {
  for (let c = 1; c <= 20; c++) {
    current.push({ fromId: w, toId: `C${String(c).padStart(3, "0")}`, distance: 100 + c, estimated: w === "WH02" && c === 5 });
  }
}
const saved = current.slice(0, 59).map((o, i) => (i === 58 ? { ...o, distance: 1 } : o));
const warehouseIds = ["WH01", "WH02"];
const customerIds = Array.from({ length: 19 }, (_, i) => `C${String(i + 1).padStart(3, "0")}`);

function renderTab(props: Partial<React.ComponentProps<typeof DistancesTab>> = {}, extra?: ReactNode) {
  return render(
    <>
    {extra}
    <DistancesTab
      distanceOverrides={current}
      savedDistanceOverrides={saved}
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

describe("DistancesTab on DataTable (SCU-2.P4.3)", () => {
  it("emits every testid in the matrix map (page 1, page 2, add form)", () => {
    renderTab();
    for (const id of [
      "distances-tab",
      "distances-tab-toolbar",
      "button-import-distances",
      "button-download-distances",
      "button-filter-menu-trigger",
      "row-distance-WH01-C001",
      "input-distance-WH01-C001",
      "button-remove-distance-WH01-C001",
      "warning-unknown-to-WH01-C020",
      "badge-distance-estimated-WH02-C005",
      "button-distances-prev",
      "button-distances-next",
      "distances-page-indicator",
      "button-add-distance-row",
    ]) {
      expect(screen.getByTestId(id)).toBeInTheDocument();
    }
    expect(screen.getByTestId("distances-page-indicator")).toHaveTextContent("Page 1 of 2");
    fireEvent.click(screen.getByTestId("button-distances-next"));
    expect(screen.getByTestId("warning-unknown-from-WH03-C020")).toBeInTheDocument();
    expect(screen.getByTestId("badge-distance-changed-WH03-C020")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("button-download-distances"));
    expect(screen.getByTestId("button-export-distances-csv")).toBeInTheDocument();
    expect(screen.getByTestId("button-export-distances-json")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("button-add-distance-row"));
    for (const id of [
      "add-distance-row-form",
      "input-new-distance-from",
      "input-new-distance-to",
      "input-new-distance-value",
      "button-add-distance-confirm",
      "button-add-distance-cancel",
    ]) {
      expect(screen.getByTestId(id)).toBeInTheDocument();
    }
    fireEvent.click(screen.getByTestId("button-add-distance-confirm"));
    expect(screen.getByTestId("text-add-distance-error")).toHaveTextContent("From ID and To ID are both required.");
  });

  it("the From/To boxes are gone; the filter menu's from/to text controls replace them", () => {
    renderTab();
    expect(within(screen.getByTestId("distances-tab-toolbar")).queryByRole("textbox")).toBeNull();
    fireEvent.click(screen.getByTestId("button-filter-menu-trigger"));
    expect(screen.getByTestId("input-filter-from")).toBeInTheDocument();
    expect(screen.getByTestId("input-filter-to")).toBeInTheDocument();
    expect(screen.getByTestId("input-filter-base-min")).toBeInTheDocument();
    expect(screen.getByTestId("input-filter-override-min")).toBeInTheDocument();
  });

  it("the pager is hidden at ≤ 50 rows and the empty state keeps its testid", () => {
    const { unmount } = renderTab({ distanceOverrides: current.slice(0, 50), savedDistanceOverrides: current.slice(0, 50) });
    expect(screen.queryByTestId("distances-page-indicator")).toBeNull();
    unmount();
    renderTab({ distanceOverrides: [], savedDistanceOverrides: [] });
    expect(screen.getByTestId("distances-tab-empty")).toHaveTextContent("No distance overrides yet");
    expect(screen.getByTestId("button-add-distance-row")).toBeInTheDocument();
  });

  it("numbers are centre-aligned (Base / Override header and cells)", () => {
    renderTab();
    const headers = within(screen.getByTestId("distances-tab")).getAllByRole("columnheader");
    expect(headers.map(h => h.textContent)).toEqual(["From", "To", "Base (mi)", "Override (mi)", ""]);
    expect(headers[2]).toHaveClass("text-center");
    expect(headers[3]).toHaveClass("text-center");
    expect(headers[0]).not.toHaveClass("text-center");
    const cells = within(screen.getByTestId("row-distance-WH01-C001")).getAllByRole("cell");
    expect(cells[3]).toHaveClass("text-center");
  });

  it("amber: a row that differs from the saved state is highlighted; an unchanged one is not", () => {
    renderTab();
    fireEvent.click(screen.getByTestId("button-distances-next"));
    expect(screen.getByTestId("row-distance-WH03-C020")).toHaveClass("bg-amber-50");
    expect(screen.getByTestId("row-distance-WH03-C011")).not.toHaveClass("bg-amber-50");
  });

  it("history read-only (D2): override inputs, remove buttons and the add trigger are disabled", () => {
    renderTab({ readOnly: true });
    expect(screen.getByTestId("input-distance-WH01-C001")).toBeDisabled();
    expect(screen.getByTestId("input-distance-WH01-C001")).toHaveAttribute("title", "Read-only while browsing result history.");
    expect(screen.getByTestId("button-remove-distance-WH01-C001")).toBeDisabled();
    expect(screen.getByTestId("button-add-distance-row")).toBeDisabled();
  });

  it("not read-only by default (live editing unchanged)", () => {
    renderTab();
    expect(screen.getByTestId("input-distance-WH01-C001")).toBeEnabled();
    expect(screen.getByTestId("button-remove-distance-WH01-C001")).toBeEnabled();
  });

  it("edit round-trip: committing an override reaches the parent and re-renders as Changed", () => {
    function Parent() {
      const [rows, setRows] = useState(current.slice(0, 3));
      return (
        <DistancesTab
          distanceOverrides={rows}
          savedDistanceOverrides={current.slice(0, 3)}
          warehouseIds={warehouseIds}
          customerIds={customerIds}
          onChange={setRows}
          canonicalUnit="mi"
        />
      );
    }
    render(<Parent />, { wrapper: Providers });
    const input = screen.getByTestId("input-distance-WH01-C002");
    fireEvent.change(input, { target: { value: "777" } });
    fireEvent.blur(input);
    expect(screen.getByTestId("input-distance-WH01-C002")).toHaveValue("777");
    expect(screen.getByTestId("badge-distance-changed-WH01-C002")).toBeInTheDocument();
    expect(screen.getByTestId("row-distance-WH01-C002")).toHaveClass("bg-amber-50");
  });

  it("focus jump: clears an active filter and moves to the target's page (jsdom proves the page; Playwright proves the scroll)", () => {
    const { rerender } = renderTab();
    fireEvent.click(screen.getByTestId("button-filter-menu-trigger"));
    fireEvent.change(screen.getByTestId("input-filter-from"), { target: { value: "WH01" } });
    expect(screen.queryByTestId("row-distance-WH03-C010")).toBeNull();
    rerender(
      <DistancesTab
        distanceOverrides={current}
        savedDistanceOverrides={saved}
        warehouseIds={warehouseIds}
        customerIds={customerIds}
        onChange={vi.fn()}
        canonicalUnit="mi"
        scenarioId={1}
        focusEntityId="WH03"
      />,
    );
    expect(screen.getByTestId("input-filter-from")).toHaveValue("");
    expect(screen.getByTestId("distances-page-indicator")).toHaveTextContent("Page 1 of 2");
    expect(screen.getByTestId("row-distance-WH03-C001")).toBeInTheDocument();
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
  });
  it("an OPEN add-row form goes read-only when history browsing starts (D2, transient controls)", () => {
    const { rerender } = renderTab();
    fireEvent.click(screen.getByTestId("button-add-distance-row"));
    for (const id of [
      "input-new-distance-from",
      "input-new-distance-to",
      "input-new-distance-value",
      "button-add-distance-confirm",
    ])
      expect(screen.getByTestId(id)).toBeEnabled();
    rerender(
      <DistancesTab
        distanceOverrides={current}
        savedDistanceOverrides={saved}
        warehouseIds={warehouseIds}
        customerIds={customerIds}
        onChange={vi.fn()}
        canonicalUnit="mi"
        scenarioId={1}
        readOnly
      />,
    );
    for (const id of [
      "input-new-distance-from",
      "input-new-distance-to",
      "input-new-distance-value",
      "button-add-distance-confirm",
    ]) {
      expect(screen.getByTestId(id)).toBeDisabled();
      expect(screen.getByTestId(id)).toHaveAttribute("title", "Read-only while browsing result history.");
    }
    expect(screen.getByTestId("button-add-distance-cancel")).toBeEnabled();
  });

  // SCU-2.P4.4 (user decision 2026-10-17) — a distance range resets on a km/mi toggle.
  it("the Override range filter resets when the display unit toggles", () => {
    function PrefToggle() {
      const u = useDisplayUnit();
      return <button data-testid="toggle-pref-mi" onClick={() => u.setPref("mi")}>mi</button>;
    }
    window.localStorage.setItem("nos:display-unit-pref", "km");
    try {
      renderTab({}, <PrefToggle />);
      const before = screen.getAllByTestId(/^row-distance-/).length;
      fireEvent.click(screen.getByTestId("button-filter-menu-trigger"));
      fireEvent.change(screen.getByTestId("input-filter-override-max"), { target: { value: "165" } });
      expect(screen.getAllByTestId(/^row-distance-/).length).toBeLessThan(before);
      fireEvent.click(screen.getByTestId("toggle-pref-mi"));
      expect(screen.getAllByTestId(/^row-distance-/).length).toBe(before);
    } finally {
      window.localStorage.removeItem("nos:display-unit-pref");
    }
  });
});
