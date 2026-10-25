// SCU-2.P4.14 — transport-coal Stations on the shared DataTable with the B2.9
// demand cell in INTEGER mode (user decision 2026-10-17): grouped, "tons"
// suffix (user decision), "." rejected, no aria-label; empty base demand clears the override;
// empty added demand is not saved and reverts on blur; history read-only on
// base AND added (D2); the "+ Add station" modal.

import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { AllProviders } from "@/__tests__/helpers/renderWithExportProvider";
import { StationsTab, type AddedStation } from "@/components/workspace/tabs/StationsTab";
import type { StationOverride } from "@/components/tables/StationTable";

const stations = [
  { id: "LAX", city: "Los Angeles", state: "CA", lat: 33.97, lng: -118.25 },
  { id: "SEA", city: "Seattle", state: "WA", lat: 47.6, lng: -122.3 },
];
const added: AddedStation[] = [
  { id: "as-1", city: "Newtown", state: "NC", lat: 35.5, lng: -80.2, demand: 900000, displayCode: "ST-NC-NEWTOWN-01" },
];

const renderTab = (props: Partial<React.ComponentProps<typeof StationsTab>> = {}) =>
  render(
    <StationsTab
      stations={stations}
      overrides={[{ id: "SEA", demand: 1234567 }]}
      onChange={vi.fn()}
      scenarioId={1}
      addedStations={added}
      onAddedStationsChange={vi.fn()}
      onDeleteStation={vi.fn()}
      {...props}
    />,
    { wrapper: AllProviders },
  );

describe("StationsTab on DataTable (SCU-2.P4.14)", () => {
  it("emits every testid in the matrix map; base demand blank when not overridden, grouped when it is", () => {
    renderTab();
    for (const id of [
      "stations-tab",
      "stations-tab-toolbar",
      "button-import-stations",
      "button-download-stations",
      "button-add-station-row",
      "input-station-demand-LAX",
      "added-stations-section",
      "row-added-station-as-1",
      "input-added-station-demand-as-1",
      "button-delete-added-station-as-1",
    ]) {
      expect(screen.getByTestId(id)).toBeInTheDocument();
    }
    expect(screen.getByTestId("input-station-demand-LAX")).toHaveValue("");
    expect(screen.getByTestId("input-station-demand-LAX")).toHaveAttribute("placeholder", "base demand");
    expect(screen.getByTestId("input-station-demand-SEA")).toHaveValue("1,234,567");
    expect(screen.getByTestId("input-added-station-demand-as-1")).toHaveValue("900,000");
  });

  it("integer mode: inputMode numeric, '.' rejected, no suffix (header carries \"tons\"), no aria-label", () => {
    renderTab();
    const input = screen.getByTestId("input-added-station-demand-as-1");
    expect(input).toHaveAttribute("inputmode", "numeric");
    expect(input).not.toHaveAttribute("aria-label");
    expect(input).not.toHaveAttribute("aria-describedby");
    expect(screen.getByRole("columnheader", { name: /Demand override \(tons\)/ })).toBeInTheDocument();
    fireEvent.change(input, { target: { value: "900,000.5" } });
    expect(input).toHaveValue("900,000");
  });

  it("emptying a base demand clears the override; emptying an added demand saves nothing and reverts on blur", () => {
    function Parent() {
      const [o, setO] = useState<StationOverride[]>([{ id: "SEA", demand: 1234567 }]);
      const [a, setA] = useState<AddedStation[]>(added);
      return (
        <>
          <StationsTab
            stations={stations}
            overrides={o}
            onChange={setO}
            addedStations={a}
            onAddedStationsChange={setA}
            onDeleteStation={vi.fn()}
          />
          <output data-testid="state">{JSON.stringify({ o, a: a.map(s => s.demand) })}</output>
        </>
      );
    }
    render(<Parent />, { wrapper: AllProviders });
    fireEvent.change(screen.getByTestId("input-station-demand-SEA"), { target: { value: "" } });
    expect(JSON.parse(screen.getByTestId("state").textContent ?? "")).toEqual({ o: [], a: [900000] });
    fireEvent.change(screen.getByTestId("input-added-station-demand-as-1"), { target: { value: "" } });
    expect(JSON.parse(screen.getByTestId("state").textContent ?? "")).toEqual({ o: [], a: [900000] });
    fireEvent.blur(screen.getByTestId("input-added-station-demand-as-1"));
    expect(screen.getByTestId("input-added-station-demand-as-1")).toHaveValue("900,000");
    fireEvent.change(screen.getByTestId("input-added-station-demand-as-1"), { target: { value: "8000000" } });
    expect(JSON.parse(screen.getByTestId("state").textContent ?? "")).toEqual({ o: [], a: [8000000] });
  });

  it("history read-only (D2): base + added demand, delete and the add trigger are disabled", () => {
    renderTab({ readOnly: true });
    for (const id of [
      "input-station-demand-LAX",
      "input-added-station-demand-as-1",
      "button-delete-added-station-as-1",
      "button-add-station-row",
    ]) {
      expect(screen.getByTestId(id)).toBeDisabled();
    }
  });

  it("+ Add station: empty demand blocks; an integer demand appends an as- station", () => {
    const onAdded = vi.fn();
    renderTab({ onAddedStationsChange: onAdded });
    fireEvent.click(screen.getByTestId("button-add-station-row"));
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
    fireEvent.change(within(d).getByTestId("create-entity-demand"), { target: { value: "8000000" } });
    fireEvent.click(within(d).getByTestId("create-entity-submit"));
    const next = onAdded.mock.calls[0]![0] as AddedStation[];
    expect(next[1]!.id).toMatch(/^as-/);
    expect(next[1]).toMatchObject({ city: "Akron", demand: 8000000, displayCode: "ST-OH-AKRON-01" });
  });
  it("an OPEN +Add modal goes read-only when history browsing starts (D2, transient controls)", () => {
    const { rerender } = renderTab();
    fireEvent.click(screen.getByTestId("button-add-station-row"));
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
      <StationsTab
        stations={stations}
        overrides={[{ id: "SEA", demand: 1234567 }]}
        onChange={vi.fn()}
        scenarioId={1}
        addedStations={added}
        onAddedStationsChange={vi.fn()}
        onDeleteStation={vi.fn()}
        readOnly
      />,
    );
    for (const id of fields) expect(screen.getByTestId(id)).toBeDisabled();
    expect(screen.getByTestId("create-entity-submit")).toHaveAttribute("title", "Read-only while browsing result history.");
    expect(screen.getByTestId("create-entity-cancel")).toBeEnabled();
  });
});
