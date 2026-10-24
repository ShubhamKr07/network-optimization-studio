// SCU-2.P4.6 — LaneCostsTab (transport-coal) on the shared DataTable (B2.1–B2.4, D2).

import { useState, type ReactNode } from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AllProviders } from "@/__tests__/helpers/renderWithExportProvider";
import { useDisplayUnit } from "@/contexts/UnitContext";
import { LaneCostsTab, type LaneCostOverride } from "@/components/workspace/tabs/LaneCostsTab";

function Providers({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={client}>
      <AllProviders>{children}</AllProviders>
    </QueryClientProvider>
  );
}

const mineIds = ["MN01", "MN02"];
const stationIds = Array.from({ length: 11 }, (_, i) => `ST${String(i + 1).padStart(3, "0")}`);
// 12 rows; MN09 is an unknown mine; the last row is unsaved (Changed).
const rows: LaneCostOverride[] = [
  ...stationIds.map((st, i) => ({ fromId: "MN01", toId: st, cost: 100 + i })),
  { fromId: "MN09", toId: "ST001", cost: 77 },
];
const saved = rows.slice(0, 11);

function renderTab(props: Partial<React.ComponentProps<typeof LaneCostsTab>> = {}, extra?: ReactNode) {
  return render(
    <>
    {extra}
    <LaneCostsTab
      laneCostOverrides={rows}
      savedLaneCostOverrides={saved}
      mineIds={mineIds}
      stationIds={stationIds}
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

describe("LaneCostsTab on DataTable (SCU-2.P4.6)", () => {
  it("emits every testid in the matrix map", () => {
    renderTab();
    for (const id of [
      "lanecosts-tab",
      "lanecosts-tab-toolbar",
      "button-import-lanecosts",
      "button-download-lanecosts",
      "button-filter-menu-trigger",
      "row-lanecost-MN01-ST001",
      "input-lanecost-MN01-ST001",
      "button-remove-lanecost-MN01-ST001",
      "warning-unknown-from-MN09-ST001",
      "badge-lanecost-changed-MN09-ST001",
      "button-add-lanecost-row",
    ]) {
      expect(screen.getByTestId(id)).toBeInTheDocument();
    }
    fireEvent.click(screen.getByTestId("button-download-lanecosts"));
    expect(screen.getByTestId("button-export-lanecosts-csv")).toBeInTheDocument();
    expect(screen.getByTestId("button-export-lanecosts-json")).toBeInTheDocument();
  });

  it("empty state keeps its testid", () => {
    renderTab({ laneCostOverrides: [], savedLaneCostOverrides: [] });
    expect(screen.getByTestId("lanecosts-tab-empty")).toHaveTextContent("No lane cost overrides yet");
  });

  it("numbers centred; amber only on the changed row", () => {
    renderTab();
    const headers = within(screen.getByTestId("lanecosts-tab")).getAllByRole("columnheader");
    expect(headers.map(h => h.textContent)).toEqual(["From (mine)", "To (station)", "Cost (mi)", ""]);
    expect(headers[2]).toHaveClass("text-center");
    expect(screen.getByTestId("row-lanecost-MN09-ST001")).toHaveClass("bg-warning-bg");
    expect(screen.getByTestId("row-lanecost-MN01-ST001")).not.toHaveClass("bg-warning-bg");
  });

  it("history read-only (D2)", () => {
    renderTab({ readOnly: true });
    expect(screen.getByTestId("input-lanecost-MN01-ST001")).toBeDisabled();
    expect(screen.getByTestId("button-remove-lanecost-MN01-ST001")).toBeDisabled();
    expect(screen.getByTestId("button-add-lanecost-row")).toBeDisabled();
  });

  it("filter menu replaces the From/To boxes", () => {
    renderTab();
    fireEvent.click(screen.getByTestId("button-filter-menu-trigger"));
    fireEvent.change(screen.getByTestId("input-filter-from"), { target: { value: "MN09" } });
    expect(screen.getByTestId("row-lanecost-MN09-ST001")).toBeInTheDocument();
    expect(screen.queryByTestId("row-lanecost-MN01-ST001")).toBeNull();
  });

  it("edit round-trip through a stateful parent", () => {
    function Parent() {
      const [r, setR] = useState(rows.slice(0, 2));
      return (
        <LaneCostsTab
          laneCostOverrides={r}
          savedLaneCostOverrides={rows.slice(0, 2)}
          mineIds={mineIds}
          stationIds={stationIds}
          onChange={setR}
          canonicalUnit="mi"
        />
      );
    }
    render(<Parent />, { wrapper: Providers });
    fireEvent.change(screen.getByTestId("input-lanecost-MN01-ST002"), { target: { value: "999" } });
    fireEvent.blur(screen.getByTestId("input-lanecost-MN01-ST002"));
    expect(screen.getByTestId("input-lanecost-MN01-ST002")).toHaveValue("999");
    expect(screen.getByTestId("badge-lanecost-changed-MN01-ST002")).toBeInTheDocument();
  });
  it("an OPEN add-row form goes read-only when history browsing starts (D2, transient controls)", () => {
    const { rerender } = renderTab();
    fireEvent.click(screen.getByTestId("button-add-lanecost-row"));
    for (const id of [
      "input-new-lanecost-from",
      "input-new-lanecost-to",
      "input-new-lanecost-value",
      "button-add-lanecost-confirm",
    ])
      expect(screen.getByTestId(id)).toBeEnabled();
    rerender(
      <LaneCostsTab
        laneCostOverrides={rows}
        savedLaneCostOverrides={saved}
        mineIds={mineIds}
        stationIds={stationIds}
        onChange={vi.fn()}
        canonicalUnit="mi"
        scenarioId={1}
        readOnly
      />,
    );
    for (const id of [
      "input-new-lanecost-from",
      "input-new-lanecost-to",
      "input-new-lanecost-value",
      "button-add-lanecost-confirm",
    ]) {
      expect(screen.getByTestId(id)).toBeDisabled();
      expect(screen.getByTestId(id)).toHaveAttribute("title", "Read-only while browsing result history.");
    }
    expect(screen.getByTestId("button-add-lanecost-cancel")).toBeEnabled();
  });

  // SCU-2.P4.6 (user decision 2026-10-17) — a cost (distance) range resets on a km/mi toggle.
  it("the Cost range filter resets when the display unit toggles", () => {
    function PrefToggle() {
      const u = useDisplayUnit();
      return <button data-testid="toggle-pref-mi" onClick={() => u.setPref("mi")}>mi</button>;
    }
    window.localStorage.setItem("nos:display-unit-pref", "km");
    try {
      renderTab({}, <PrefToggle />);
      const before = screen.getAllByTestId(/^row-lanecost-/).length;
      fireEvent.click(screen.getByTestId("button-filter-menu-trigger"));
      fireEvent.change(screen.getByTestId("input-filter-cost-min"), { target: { value: "170" } });
      expect(screen.getAllByTestId(/^row-lanecost-/).length).toBeLessThan(before);
      fireEvent.click(screen.getByTestId("toggle-pref-mi"));
      expect(screen.getAllByTestId(/^row-lanecost-/).length).toBe(before);
    } finally {
      window.localStorage.removeItem("nos:display-unit-pref");
    }
  });
});
