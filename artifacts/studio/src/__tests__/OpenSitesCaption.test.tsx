import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { SolveResult } from "@workspace/api-client-react";
import type { EntityIdentity } from "@/lib/entityIdentity";
import { OpenSitesCaption } from "@/components/workspace/OpenSitesCaption";

// QFX-8 — the one-line caption above the Output Map.
const res = (details: Record<string, unknown>, metrics: Record<string, unknown> = {}): SolveResult =>
  ({ status: "optimal", objective: 1, edges: [], metrics, details }) as unknown as SolveResult;

const sevenIds = ["W10", "W2", "W7", "W1", "W3", "W30", "W4"];
const identity = (ids: string[]): Record<string, EntityIdentity> =>
  Object.fromEntries(ids.map(id => [id, { displayId: id, city: `City${id}`, state: "TX" }]));

describe("OpenSitesCaption — ordering and +N more", () => {
  it("lists the first five in ascending numeric-aware id order, then '+N more'", () => {
    render(<OpenSitesCaption result={res({ openWarehouseIds: sevenIds })} modelId="p-median-us" identityById={identity(sevenIds)} />);
    expect(screen.getByTestId("output-map-open-sites").textContent).toBe(
      "Open warehouses: W1 · CityW1, TX, W2 · CityW2, TX, W3 · CityW3, TX, W4 · CityW4, TX, W7 · CityW7, TX +2 more",
    );
    expect(screen.getByTestId("output-map-open-sites-toggle")).toHaveAttribute("aria-expanded", "false");
  });

  it("'+N more' expands to the full list and 'Show fewer' collapses it", async () => {
    render(<OpenSitesCaption result={res({ openWarehouseIds: sevenIds })} modelId="p-median-us" identityById={identity(sevenIds)} />);
    await userEvent.click(screen.getByRole("button", { name: "+2 more" }));
    expect(screen.getByTestId("output-map-open-sites").textContent).toBe(
      "Open warehouses: W1 · CityW1, TX, W2 · CityW2, TX, W3 · CityW3, TX, W4 · CityW4, TX, W7 · CityW7, TX, W10 · CityW10, TX, W30 · CityW30, TX Show fewer",
    );
    expect(screen.getByTestId("output-map-open-sites-toggle")).toHaveAttribute("aria-expanded", "true");
    await userEvent.click(screen.getByRole("button", { name: "Show fewer" }));
    expect(screen.getByTestId("output-map-open-sites")).toHaveTextContent("W7 · CityW7, TX +2 more");
    expect(screen.getByTestId("output-map-open-sites")).not.toHaveTextContent("W10");
  });

  it("five or fewer sites: all listed, no toggle", () => {
    const five = ["W5", "W4", "W3", "W2", "W1"];
    render(<OpenSitesCaption result={res({ openWarehouseIds: five })} modelId="p-median-us" identityById={identity(five)} />);
    expect(screen.getByTestId("output-map-open-sites")).toHaveTextContent("W1 · CityW1, TX, W2 · CityW2, TX, W3 · CityW3, TX, W4 · CityW4, TX, W5 · CityW5, TX");
    expect(screen.queryByTestId("output-map-open-sites-toggle")).not.toBeInTheDocument();
  });
});

describe("OpenSitesCaption — labels", () => {
  it("uses the identity's displayId (an added row's display code), and just the id when city and state are empty", () => {
    render(
      <OpenSitesCaption
        result={res({ openWarehouseIds: ["aw-123", "W1"] })}
        modelId="p-median-us"
        identityById={{ "aw-123": { displayId: "W99", city: "", state: "" }, W1: { displayId: "W1", city: "Dallas", state: "TX" } }}
      />,
    );
    expect(screen.getByTestId("output-map-open-sites").textContent).toBe("Open warehouses: W1 · Dallas, TX, W99");
  });

  it("an id with no identity entry is shown raw", () => {
    render(<OpenSitesCaption result={res({ openWarehouseIds: ["X7"] })} modelId="p-median-us" identityById={{}} />);
    expect(screen.getByTestId("output-map-open-sites").textContent).toBe("Open warehouses: X7");
  });

  it("a blank state falls back to the city alone (formatCityState)", () => {
    render(<OpenSitesCaption result={res({ openWarehouseIds: ["W1"] })} modelId="p-median-us" identityById={{ W1: { displayId: "W1", city: "Dallas", state: "" } }} />);
    expect(screen.getByTestId("output-map-open-sites").textContent).toBe("Open warehouses: W1 · Dallas");
  });
});

describe("OpenSitesCaption — noun per model and source field", () => {
  it.each([
    ["p-median-us", "Open warehouses"],
    ["p-median-brazil", "Open warehouses"],
    ["max-coverage-us", "Open warehouses"],
    ["delivery-teaching-us", "Open warehouses"],
    ["transport-coal", "Open mines"],
    ["two-echelon-gold-au", "Open facilities"],
    ["two-echelon-jade-us", "Open facilities"],
    ["super-model", "Open facilities"],
    ["some-future-model", "Open sites"],
  ])("%s -> %s", (modelId, noun) => {
    render(<OpenSitesCaption result={res({ openWarehouseIds: ["A"] }, { openFacilityIds: ["A"] })} modelId={modelId} identityById={{}} />);
    expect(screen.getByTestId("output-map-open-sites").textContent).toBe(`${noun}: A`);
  });

  it("no modelId falls back to 'Open sites'", () => {
    render(<OpenSitesCaption result={res({ openWarehouseIds: ["A"] })} identityById={{}} />);
    expect(screen.getByTestId("output-map-open-sites").textContent).toBe("Open sites: A");
  });

  it("super-model names metrics.openFacilityIds, not details", () => {
    render(<OpenSitesCaption result={res({ openWarehouseIds: ["wh-9"] }, { openFacilityIds: ["wh-2"] })} modelId="super-model" identityById={{}} />);
    expect(screen.getByTestId("output-map-open-sites").textContent).toBe("Open facilities: wh-2");
  });
});

describe("OpenSitesCaption — hidden", () => {
  it("renders nothing for zero open sites", () => {
    const { container } = render(<OpenSitesCaption result={res({ openWarehouseIds: [] })} modelId="p-median-us" identityById={{}} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing without a result", () => {
    const { container } = render(<OpenSitesCaption result={null} modelId="p-median-us" identityById={{}} />);
    expect(container).toBeEmptyDOMElement();
  });
});
