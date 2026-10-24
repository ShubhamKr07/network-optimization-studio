// SCU-2.P4.8 — TransportCostsTab (JADE) on the shared DataTable (B2.1): the
// matrix testids survive (incl. the header testid on the <th>), numbers are
// centred, no filter/pager at two rows, and history read-only still disables
// all four fields and Reset (D2 — this tab already had it).

import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { UnitProvider } from "@/contexts/UnitContext";
import { TransportCostsTab } from "@/components/workspace/tabs/TransportCostsTab";
import { TEXTBOOK_TRANSPORT_COSTS } from "@/lib/transportCosts";

const renderTab = (disabled = false) =>
  render(
    <UnitProvider>
      <TransportCostsTab
        canonicalUnit="mi"
        transportCosts={TEXTBOOK_TRANSPORT_COSTS}
        isCustom
        onChange={vi.fn()}
        onReset={vi.fn()}
        scenarioId={1}
        disabled={disabled}
      />
    </UnitProvider>,
  );

describe("TransportCostsTab on DataTable (SCU-2.P4.8)", () => {
  it("emits every testid in the matrix map; the rate-unit header testid sits on the <th>", () => {
    renderTab();
    for (const id of [
      "transport-costs-tab",
      "label-transport-rate-unit-head",
      "row-transport-ic",
      "row-transport-ob",
      "input-transport-ic-rate",
      "input-transport-ob-rate",
      "input-transport-ic-min",
      "input-transport-ob-min",
      "text-transport-formula",
      "button-transport-reset",
    ]) {
      expect(screen.getByTestId(id)).toBeInTheDocument();
    }
    expect(screen.getByTestId("label-transport-rate-unit-head").tagName).toBe("TH");
    expect(screen.queryByTestId("label-transport-rate-unit-ic")).toBeNull();
    expect(screen.queryByTestId("label-transport-min-unit-ob")).toBeNull();
    expect(screen.queryByTestId("button-filter-menu-trigger")).toBeNull();
  });

  it("numbers are centred; header texts unchanged", () => {
    renderTab();
    const headers = within(screen.getByTestId("transport-costs-tab")).getAllByRole("columnheader");
    expect(headers.map(h => h.textContent)).toEqual(["Leg", "Rate ($/ton-mi)", "Min ($/ton)"]);
    expect(headers[1]).toHaveClass("text-center");
    expect(headers[2]).toHaveClass("text-center");
    expect(headers[0]).not.toHaveClass("text-center");
  });

  it("history read-only disables every field and Reset", () => {
    renderTab(true);
    for (const id of [
      "input-transport-ic-rate",
      "input-transport-ob-rate",
      "input-transport-ic-min",
      "input-transport-ob-min",
      "button-transport-reset",
    ]) {
      expect(screen.getByTestId(id)).toBeDisabled();
      expect(screen.getByTestId(id)).toHaveAttribute("title", "Read-only while browsing result history.");
    }
  });

  it("outside history no field or Reset carries the read-only title", () => {
    renderTab();
    for (const id of [
      "input-transport-ic-rate",
      "input-transport-ob-rate",
      "input-transport-ic-min",
      "input-transport-ob-min",
      "button-transport-reset",
    ]) {
      expect(screen.getByTestId(id)).not.toHaveAttribute("title");
    }
  });
});
