// SCU-2.P4.12 — JADE Plants on the shared DataTable (spec B2.1–B2.4, B2.8,
// D2): matrix testids, one filter menu over base + added, history read-only
// on the added rows' delete and the add trigger, and the "+ Add plant" modal.

import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { AllProviders } from "@/__tests__/helpers/renderWithExportProvider";
import { PlantsTab, type AddedPlant } from "@/components/workspace/tabs/PlantsTab";

const plants = [
  { id: "plant-1", name: "Plant One", city: "Ashland", state: "KY", lat: 38.4, lng: -82.6 },
  { id: "plant-2", name: "Plant Two", city: "Toledo", state: "OH", lat: 41.6, lng: -83.5 },
];
const added: AddedPlant[] = [{ id: "ap-1", city: "Dallas", state: "TX", lat: 32.78, lng: -96.8, displayCode: "PL-TX-DALLAS-01" }];

const renderTab = (props: Partial<React.ComponentProps<typeof PlantsTab>> = {}) =>
  render(
    <PlantsTab
      plants={plants}
      scenarioId={1}
      addedPlants={added}
      onAddedPlantsChange={vi.fn()}
      onDeletePlant={vi.fn()}
      {...props}
    />,
    { wrapper: AllProviders },
  );

describe("PlantsTab on DataTable (SCU-2.P4.12)", () => {
  it("emits every testid in the matrix map", () => {
    renderTab();
    for (const id of [
      "plants-tab",
      "plants-tab-toolbar",
      "button-import-plants",
      "button-download-plants",
      "button-add-plant-row",
      "added-plants-section",
      "row-added-plant-ap-1",
      "button-delete-added-plant-ap-1",
    ]) {
      expect(screen.getByTestId(id)).toBeInTheDocument();
    }
    // base rows show the plant NAME (unchanged), added rows the display code
    expect(screen.getByText("Plant One")).toBeInTheDocument();
    expect(within(screen.getByTestId("row-added-plant-ap-1")).getByText("PL-TX-DALLAS-01")).toBeInTheDocument();
  });

  it("empty-dataset and empty-added states keep their testids", () => {
    renderTab({ plants: [], addedPlants: [] });
    expect(screen.getByTestId("plants-tab-empty")).toHaveTextContent("No plants in this dataset.");
    expect(screen.getByTestId("added-plants-empty")).toBeInTheDocument();
  });

  it("history read-only (D2): delete and the add trigger are disabled (they had no disabled prop)", () => {
    renderTab({ readOnly: true });
    expect(screen.getByTestId("button-delete-added-plant-ap-1")).toBeDisabled();
    expect(screen.getByTestId("button-add-plant-row")).toBeDisabled();
  });

  it("+ Add plant opens the modal (no status, no value); submit appends an ap-/PL- plant", () => {
    const onAdded = vi.fn();
    renderTab({ onAddedPlantsChange: onAdded });
    fireEvent.click(screen.getByTestId("button-add-plant-row"));
    const d = screen.getByTestId("create-entity-dialog");
    expect(within(d).queryByTestId("create-entity-status")).toBeNull();
    expect(within(d).queryByTestId("create-entity-capacity")).toBeNull();
    for (const [id, v] of [
      ["create-entity-city", "Akron"],
      ["create-entity-state", "OH"],
      ["create-entity-lat", "41.08"],
      ["create-entity-lng", "-81.52"],
    ] as const) {
      fireEvent.change(within(d).getByTestId(id), { target: { value: v } });
    }
    fireEvent.click(within(d).getByTestId("create-entity-submit"));
    const next = onAdded.mock.calls[0]![0] as AddedPlant[];
    expect(next).toHaveLength(2);
    expect(next[1]!.id).toMatch(/^ap-/);
    expect(next[1]).toMatchObject({ city: "Akron", state: "OH", lat: 41.08, lng: -81.52, displayCode: "PL-OH-AKRON-01" });
  });
  it("an OPEN +Add modal goes read-only when history browsing starts (D2, transient controls)", () => {
    const { rerender } = renderTab();
    fireEvent.click(screen.getByTestId("button-add-plant-row"));
    const fields = [
      "create-entity-city",
      "create-entity-state",
      "create-entity-lat",
      "create-entity-lng",
      "create-entity-display-code",
      "create-entity-submit",
    ];
    for (const id of fields) expect(screen.getByTestId(id)).toBeEnabled();
    rerender(
      <PlantsTab
        plants={plants}
        scenarioId={1}
        addedPlants={added}
        onAddedPlantsChange={vi.fn()}
        onDeletePlant={vi.fn()}
        readOnly
      />,
    );
    for (const id of fields) expect(screen.getByTestId(id)).toBeDisabled();
    expect(screen.getByTestId("create-entity-submit")).toHaveAttribute("title", "Read-only while browsing result history.");
    expect(screen.getByTestId("create-entity-cancel")).toBeEnabled();
  });
});
