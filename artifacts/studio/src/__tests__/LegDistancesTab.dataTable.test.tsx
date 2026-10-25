// SCU-2.P4.4 — LegDistancesTab (two-echelon-gold-au) on the shared DataTable
// (spec B2.1–B2.4, D2): matrix testids, leg filter, history read-only, amber
// changed rows, centred numbers, focus jump, one edit round-trip.

import { useState, type ReactNode } from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { useDisplayUnit } from "@/contexts/UnitContext";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AllProviders } from "@/__tests__/helpers/renderWithExportProvider";
import { LegDistancesTab, type LegDistanceOverride } from "@/components/workspace/tabs/LegDistancesTab";

function Providers({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={client}>
      <AllProviders>{children}</AllProviders>
    </QueryClientProvider>
  );
}

const mineIds = ["kalgoorlie"];
const refineryIds = ["daggar-hills", "cunnamulla"];
const customerIds = ["sydney", "melbourne", ...Array.from({ length: 10 }, (_, i) => `town-${i}`)];
// 12 rows: 1 mine→refinery, 11 refinery→customer; the last is unsaved (Changed).
const rows: LegDistanceOverride[] = [
  { fromId: "kalgoorlie", toId: "daggar-hills", distance: 293.7 },
  { fromId: "cunnamulla", toId: "sydney", distance: 610.5 },
  { fromId: "daggar-hills", toId: "melbourne", distance: 2019.2 },
  ...Array.from({ length: 9 }, (_, i) => ({ fromId: "cunnamulla", toId: `town-${i}`, distance: 100 + i })),
];
const saved = rows.slice(0, 11);

function renderTab(props: Partial<React.ComponentProps<typeof LegDistancesTab>> = {}, extra?: ReactNode) {
  return render(
    <>
    {extra}
    <LegDistancesTab
      distanceOverrides={rows}
      savedDistanceOverrides={saved}
      mineIds={mineIds}
      refineryIds={refineryIds}
      customerIds={customerIds}
      onChange={vi.fn()}
      canonicalUnit="km"
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

describe("LegDistancesTab on DataTable (SCU-2.P4.4)", () => {
  it("emits every testid in the matrix map", () => {
    renderTab();
    for (const id of [
      "legdistances-tab",
      "legdistances-tab-toolbar",
      "button-import-legdistances",
      "button-download-legdistances",
      "button-filter-menu-trigger",
      "row-legdistance-kalgoorlie-daggar-hills",
      "section-leg-mine_to_refinery",
      "input-legdistance-kalgoorlie-daggar-hills",
      "button-remove-legdistance-kalgoorlie-daggar-hills",
      "badge-legdistance-changed-cunnamulla-town-8",
      "button-add-legdistance-row",
    ]) {
      expect(screen.getByTestId(id)).toBeInTheDocument();
    }
    expect(screen.getByTestId("section-leg-mine_to_refinery")).toHaveTextContent("Mine → Refinery");
    fireEvent.click(screen.getByTestId("button-download-legdistances"));
    expect(screen.getByTestId("button-export-legdistances-csv")).toBeInTheDocument();
    expect(screen.getByTestId("button-export-legdistances-json")).toBeInTheDocument();
  });

  it("empty state keeps its testid and the add trigger", () => {
    renderTab({ distanceOverrides: [], savedDistanceOverrides: [] });
    expect(screen.getByTestId("legdistances-tab-empty")).toHaveTextContent("No leg distance overrides yet");
    expect(screen.getByTestId("button-add-legdistance-row")).toBeInTheDocument();
    expect(screen.queryByTestId("button-filter-menu-trigger")).toBeNull();
  });

  it("there is no Leg column or Leg filter any more: the leg is a group header (Q6)", () => {
    renderTab();
    fireEvent.click(screen.getByTestId("button-filter-menu-trigger"));
    expect(screen.queryByTestId("checkbox-filter-leg-Mine → Refinery")).toBeNull();
    expect(screen.getByTestId("section-leg-mine_to_refinery")).toContainElement(screen.getByTestId("row-legdistance-kalgoorlie-daggar-hills"));
    expect(screen.getByTestId("section-leg-refinery_to_customer")).toContainElement(screen.getByTestId("row-legdistance-cunnamulla-sydney"));
  });

  it("numbers centred; amber on the changed row only", () => {
    renderTab();
    const headers = within(screen.getByTestId("section-leg-mine_to_refinery")).getAllByRole("columnheader");
    expect(headers.map(h => h.textContent)).toEqual(["From", "To", "Distance (km)", ""]);
    expect(headers[2]).toHaveClass("text-center");
    expect(screen.getByTestId("row-legdistance-cunnamulla-town-8")).toHaveClass("bg-warning-bg");
    expect(screen.getByTestId("row-legdistance-cunnamulla-sydney")).not.toHaveClass("bg-warning-bg");
  });

  it("history read-only (D2): value inputs, remove buttons and the add trigger are disabled", () => {
    renderTab({ readOnly: true });
    expect(screen.getByTestId("input-legdistance-cunnamulla-sydney")).toBeDisabled();
    expect(screen.getByTestId("button-remove-legdistance-cunnamulla-sydney")).toBeDisabled();
    expect(screen.getByTestId("button-add-legdistance-row")).toBeDisabled();
  });

  it("focus jump clears an active filter and scrolls the row into view", () => {
    const { rerender } = renderTab();
    fireEvent.click(screen.getByTestId("button-filter-menu-trigger"));
    fireEvent.change(screen.getByTestId("input-filter-from"), { target: { value: "kalgoorlie" } });
    expect(screen.queryByTestId("row-legdistance-cunnamulla-sydney")).toBeNull();
    rerender(
      <LegDistancesTab
        distanceOverrides={rows}
        savedDistanceOverrides={saved}
        mineIds={mineIds}
        refineryIds={refineryIds}
        customerIds={customerIds}
        onChange={vi.fn()}
        canonicalUnit="km"
        scenarioId={1}
        focusEntityId="sydney"
      />,
    );
    expect(screen.getByTestId("input-filter-from")).toHaveValue("");
    expect(screen.getByTestId("row-legdistance-cunnamulla-sydney")).toBeInTheDocument();
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
  });

  it("edit round-trip through a stateful parent", () => {
    function Parent() {
      const [r, setR] = useState(rows.slice(0, 3));
      return (
        <LegDistancesTab
          distanceOverrides={r}
          savedDistanceOverrides={rows.slice(0, 3)}
          mineIds={mineIds}
          refineryIds={refineryIds}
          customerIds={customerIds}
          onChange={setR}
          canonicalUnit="km"
        />
      );
    }
    render(<Parent />, { wrapper: Providers });
    const input = screen.getByTestId("input-legdistance-cunnamulla-sydney");
    fireEvent.change(input, { target: { value: "700" } });
    fireEvent.blur(input);
    expect(screen.getByTestId("input-legdistance-cunnamulla-sydney")).toHaveValue("700");
    expect(screen.getByTestId("row-legdistance-cunnamulla-sydney")).toHaveClass("bg-warning-bg");
  });
  it("an OPEN add-row form goes read-only when history browsing starts (D2, transient controls)", () => {
    const { rerender } = renderTab();
    fireEvent.click(screen.getByTestId("button-add-legdistance-row"));
    for (const id of [
      "input-new-legdistance-from",
      "input-new-legdistance-to",
      "input-new-legdistance-value",
      "button-add-legdistance-confirm",
    ])
      expect(screen.getByTestId(id)).toBeEnabled();
    rerender(
      <LegDistancesTab
        distanceOverrides={rows}
        savedDistanceOverrides={saved}
        mineIds={mineIds}
        refineryIds={refineryIds}
        customerIds={customerIds}
        onChange={vi.fn()}
        canonicalUnit="km"
        scenarioId={1}
        readOnly
      />,
    );
    for (const id of [
      "input-new-legdistance-from",
      "input-new-legdistance-to",
      "input-new-legdistance-value",
      "button-add-legdistance-confirm",
    ]) {
      expect(screen.getByTestId(id)).toBeDisabled();
      expect(screen.getByTestId(id)).toHaveAttribute("title", "Read-only while browsing result history.");
    }
    expect(screen.getByTestId("button-add-legdistance-cancel")).toBeEnabled();
  });

  // SCU-2.P4.4 (user decision 2026-10-17) — a distance range resets on a km/mi toggle.
  it("the Distance range filter resets when the display unit toggles", () => {
    function PrefToggle() {
      const u = useDisplayUnit();
      return <button data-testid="toggle-pref-mi" onClick={() => u.setPref("mi")}>mi</button>;
    }
    window.localStorage.setItem("nos:display-unit-pref", "km");
    try {
      renderTab({}, <PrefToggle />);
      const before = screen.getAllByTestId(/^row-legdistance-/).length;
      fireEvent.click(screen.getByTestId("button-filter-menu-trigger"));
      fireEvent.change(screen.getByTestId("input-filter-distance-max"), { target: { value: "150" } });
      expect(screen.getAllByTestId(/^row-legdistance-/).length).toBeLessThan(before);
      fireEvent.click(screen.getByTestId("toggle-pref-mi"));
      expect(screen.getAllByTestId(/^row-legdistance-/).length).toBe(before);
    } finally {
      window.localStorage.removeItem("nos:display-unit-pref");
    }
  });
});
