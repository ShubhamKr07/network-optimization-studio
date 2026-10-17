// SCU-2.P4.13 — transport-coal Mines on the shared DataTable (spec B2.1–B2.4,
// B2.8, D2): matrix testids, history read-only on base AND added (no disabled
// prop existed), the "+ Add mine" modal, one capacity round-trip.

import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { AllProviders } from "@/__tests__/helpers/renderWithExportProvider";
import { MinesTab, type AddedMine } from "@/components/workspace/tabs/MinesTab";
import type { MineOverride } from "@/components/tables/MineTable";

const mines = [
  { id: "KY", city: "Pikeville", state: "KY", lat: 37.5, lng: -82.5 },
  { id: "WV", city: "Beckley", state: "WV", lat: 37.8, lng: -81.2 },
];
const added: AddedMine[] = [
  { id: "am-1", city: "Bristol", state: "VA", lat: 36.6, lng: -82.19, capacity: 1000, displayCode: "MN-VA-BRISTOL-01" },
];

const renderTab = (props: Partial<React.ComponentProps<typeof MinesTab>> = {}) =>
  render(
    <MinesTab
      mines={mines}
      overrides={[]}
      onChange={vi.fn()}
      scenarioId={1}
      addedMines={added}
      onAddedMinesChange={vi.fn()}
      onDeleteMine={vi.fn()}
      {...props}
    />,
    {
      wrapper: AllProviders,
    },
  );

describe("MinesTab on DataTable (SCU-2.P4.13)", () => {
  it("emits every testid in the matrix map; headers unchanged", () => {
    renderTab();
    for (const id of [
      "mines-tab",
      "mines-tab-toolbar",
      "button-import-mines",
      "button-download-mines",
      "button-add-mine-row",
      "input-mine-capacity-KY",
      "added-mines-section",
      "row-added-mine-am-1",
      "input-added-mine-capacity-am-1",
      "button-delete-added-mine-am-1",
    ]) {
      expect(screen.getByTestId(id)).toBeInTheDocument();
    }
    expect(screen.getByTestId("input-mine-capacity-KY")).toHaveAttribute("placeholder", "base capacity");
    expect(screen.getByTestId("input-added-mine-capacity-am-1")).toHaveValue(1000);
    expect(
      screen
        .getAllByRole("columnheader")
        .map(h => h.textContent)
        .slice(0, 6),
    ).toEqual(["ID", "City", "State", "Latitude", "Longitude", "Capacity override (tons)"]);
  });

  it("history read-only (D2): base + added capacity, delete and the add trigger are disabled", () => {
    renderTab({ readOnly: true });
    for (const id of [
      "input-mine-capacity-KY",
      "input-added-mine-capacity-am-1",
      "button-delete-added-mine-am-1",
      "button-add-mine-row",
    ]) {
      expect(screen.getByTestId(id)).toBeDisabled();
    }
  });

  it("+ Add mine: the modal has Capacity, no status; submit appends an am- mine", () => {
    const onAdded = vi.fn();
    renderTab({ onAddedMinesChange: onAdded });
    fireEvent.click(screen.getByTestId("button-add-mine-row"));
    const d = screen.getByTestId("create-entity-dialog");
    expect(within(d).queryByTestId("create-entity-status")).toBeNull();
    for (const [id, v] of [
      ["create-entity-city", "Pikeville"],
      ["create-entity-state", "KY"],
      ["create-entity-lat", "37.54"],
      ["create-entity-lng", "-82.75"],
      ["create-entity-capacity", "25000000"],
    ] as const) {
      fireEvent.change(within(d).getByTestId(id), { target: { value: v } });
    }
    fireEvent.click(within(d).getByTestId("create-entity-submit"));
    const next = onAdded.mock.calls[0]![0] as AddedMine[];
    expect(next[1]!.id).toMatch(/^am-/);
    expect(next[1]).toMatchObject({ city: "Pikeville", capacity: 25000000, displayCode: "MN-KY-PIKEVILLE-01" });
  });

  it("capacity round-trip: a base override appears and clears", () => {
    function Parent() {
      const [o, setO] = useState<MineOverride[]>([]);
      return <MinesTab mines={mines} overrides={o} onChange={setO} />;
    }
    render(<Parent />, { wrapper: AllProviders });
    fireEvent.change(screen.getByTestId("input-mine-capacity-KY"), { target: { value: "5000" } });
    expect(screen.getByTestId("input-mine-capacity-KY")).toHaveValue(5000);
    fireEvent.change(screen.getByTestId("input-mine-capacity-KY"), { target: { value: "" } });
    expect(screen.getByTestId("input-mine-capacity-KY")).toHaveValue(null);
  });
  it("an OPEN +Add modal goes read-only when history browsing starts (D2, transient controls)", () => {
    const { rerender } = renderTab();
    fireEvent.click(screen.getByTestId("button-add-mine-row"));
    const fields = [
      "create-entity-city",
      "create-entity-state",
      "create-entity-lat",
      "create-entity-lng",
      "create-entity-display-code",
      "create-entity-capacity",
      "create-entity-submit",
    ];
    for (const id of fields) expect(screen.getByTestId(id)).toBeEnabled();
    rerender(
      <MinesTab
        mines={mines}
        overrides={[]}
        onChange={vi.fn()}
        scenarioId={1}
        addedMines={added}
        onAddedMinesChange={vi.fn()}
        onDeleteMine={vi.fn()}
        readOnly
      />,
    );
    for (const id of fields) expect(screen.getByTestId(id)).toBeDisabled();
    expect(screen.getByTestId("create-entity-submit")).toHaveAttribute("title", "Read-only while browsing result history.");
    expect(screen.getByTestId("create-entity-cancel")).toBeEnabled();
  });
});
