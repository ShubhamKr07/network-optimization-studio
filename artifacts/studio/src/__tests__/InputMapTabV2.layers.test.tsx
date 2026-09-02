import { describe, it, expect, vi } from "vitest";
import { render, fireEvent, screen } from "@testing-library/react";
import { InputMapTab } from "@/components/workspace/tabs/InputMapTab";
import type {
  MapWarehouse,
  MapCustomer,
  PMedianMapInputs,
} from "@/components/workspace/map/types";
import type { TransportMapInputs, TwoEchelonMapInputs } from "@/components/workspace/tabs/InputMapTab";

// T8 (Bundle 2.2, A3) — pmedian/twoEchelon modes now call `useListModels()`
// internally; an empty list is a safe default (capability false, control
// hidden) — this file only exercises A1/A2 layer/legend/sizing behavior,
// unrelated to the added-customer status control.
vi.mock("@workspace/api-client-react", () => ({
  useListModels: () => ({ data: [] }),
}));

// T3 (Bundle 2.2, A1+A2) — layer-visibility toggles are now real shadcn
// `Checkbox`es (not `ToggleChip` buttons) across all three Input Map
// toolbars, per model applicability (p-median-us/brazil: Warehouses/
// Customers + Show-inactive; transport-coal: Mines/Stations, NO
// Show-inactive; two-echelon: Refineries/Customers + Show-inactive), plus a
// new "Size customers by demand" checkbox (default ON) present in all three,
// and the legend now follows the live toggle state instead of always
// rendering every group. This file is deliberately separate from
// InputMapTabV2.{test,transport.test,twoEchelon.test}.tsx (which already
// cover create/delete/move/edit/copy dispatch) — it only proves the new A1/A2
// toolbar/legend/sizing contract, reusing the same real-jsdom-MapContainer
// convention those files establish.

// ── p-median fixtures ───────────────────────────────────────────────────

const baseWh = (over: Partial<MapWarehouse> = {}): MapWarehouse => ({
  id: "CHI",
  displayCode: "CHI",
  city: "Chicago",
  state: "IL",
  lat: 41.8,
  lng: -87.6,
  capacity: null,
  status: "active",
  isAdded: false,
  ...over,
});

// A wide demand spread so the default (sizeByDemand ON) scale produces more
// than one distinct bucket/radius — otherwise an ON-vs-OFF width comparison
// couldn't tell the two states apart.
const csPopulation: MapCustomer[] = [100, 500, 1000, 2000, 5000, 12000, 20000, 50000].map((demand, i) => ({
  id: `C${i}`,
  displayCode: `C${i}`,
  city: "New York",
  state: "NY",
  lat: 40.7 + i * 0.01,
  lng: -74.0,
  demand,
  excluded: false,
  isAdded: false,
}));

function makePMedianInputs(over: Partial<PMedianMapInputs> = {}): PMedianMapInputs {
  return {
    addedWarehouses: [],
    addedCustomers: [],
    warehouseOverrides: [],
    customerOverrides: [],
    distanceOverrides: [],
    capacityMode: "none",
    ...over,
  };
}

function renderPMedian(over: { warehouses?: MapWarehouse[]; customers?: MapCustomer[]; inputs?: PMedianMapInputs } = {}) {
  const onInputsChange = vi.fn();
  const view = render(
    <InputMapTab
      mode="pmedian"
      warehouses={over.warehouses ?? [baseWh()]}
      customers={over.customers ?? csPopulation}
      inputs={over.inputs ?? makePMedianInputs()}
      onInputsChange={onInputsChange}
    />,
  );
  return { ...view, onInputsChange };
}

// ── transport fixtures ──────────────────────────────────────────────────

const baseMine = (over: Partial<MapWarehouse> = {}): MapWarehouse => ({
  id: "MN1",
  displayCode: "MN1",
  city: "Beckley",
  state: "WV",
  lat: 37.8,
  lng: -81.2,
  capacity: null,
  isAdded: false,
  ...over,
});

const stationPopulation: MapCustomer[] = [100, 500, 1000, 2000, 5000, 12000, 20000, 50000].map((demand, i) => ({
  id: `ST${i}`,
  displayCode: `ST${i}`,
  city: "Newark",
  state: "NJ",
  lat: 40.7 + i * 0.01,
  lng: -74.2,
  demand,
  excluded: false,
  isAdded: false,
}));

function makeTransportInputs(over: Partial<TransportMapInputs> = {}): TransportMapInputs {
  return {
    addedMines: [],
    addedStations: [],
    laneCostOverrides: [],
    mineCapacities: {},
    stationDemands: {},
    ...over,
  };
}

function renderTransport(over: { mines?: MapWarehouse[]; stations?: MapCustomer[]; inputs?: TransportMapInputs } = {}) {
  const onInputsChange = vi.fn();
  const view = render(
    <InputMapTab
      mode="transport"
      mines={over.mines ?? [baseMine()]}
      stations={over.stations ?? stationPopulation}
      inputs={over.inputs ?? makeTransportInputs()}
      onInputsChange={onInputsChange}
    />,
  );
  return { ...view, onInputsChange };
}

// ── two-echelon fixtures ────────────────────────────────────────────────

const baseMineTwoEchelon = (over: Partial<MapWarehouse> = {}): MapWarehouse => ({
  id: "kalgoorlie",
  displayCode: "kalgoorlie",
  city: "Kalgoorlie",
  state: "WA",
  lat: -30.7,
  lng: 121.4,
  isAdded: false,
  ...over,
});

const baseRefinery = (over: Partial<MapWarehouse> = {}): MapWarehouse => ({
  id: "cunnamulla",
  displayCode: "cunnamulla",
  city: "Cunnamulla",
  state: "QLD",
  lat: -28.07,
  lng: 145.68,
  status: "active",
  isAdded: false,
  ...over,
});

const baseCustomer = (over: Partial<MapCustomer> = {}): MapCustomer => ({
  id: "sydney",
  displayCode: "sydney",
  city: "Sydney",
  state: "NSW",
  lat: -33.87,
  lng: 151.2,
  demand: 100000,
  excluded: false,
  isAdded: false,
  ...over,
});

function makeTwoEchelonInputs(over: Partial<TwoEchelonMapInputs> = {}): TwoEchelonMapInputs {
  return {
    addedRefineries: [],
    addedCustomers: [],
    refineryOverrides: [],
    customerOverrides: [],
    distanceOverrides: [],
    ...over,
  };
}

function renderTwoEchelon(over: {
  mine?: MapWarehouse | null;
  refineries?: MapWarehouse[];
  customers?: MapCustomer[];
  inputs?: TwoEchelonMapInputs;
} = {}) {
  const onInputsChange = vi.fn();
  const view = render(
    <InputMapTab
      mode="twoEchelon"
      mine={over.mine === undefined ? baseMineTwoEchelon() : over.mine}
      refineries={over.refineries ?? [baseRefinery()]}
      customers={over.customers ?? [baseCustomer()]}
      inputs={over.inputs ?? makeTwoEchelonInputs()}
      onInputsChange={onInputsChange}
    />,
  );
  return { ...view, onInputsChange };
}

// ── A1: per-model applicability matrix ──────────────────────────────────

describe("Input Map — A1 layer checkboxes (p-median-us/brazil)", () => {
  it("renders shadcn Checkboxes (not buttons) for Warehouses/Customers/Show-inactive, and a Size-by-demand checkbox; place-pin controls stay real buttons", () => {
    renderPMedian();
    for (const testId of ["toggle-layer-warehouses", "toggle-layer-customers", "toggle-layer-show-inactive", "toggle-layer-size-by-demand"]) {
      const el = screen.getByTestId(testId);
      expect(el.tagName).toBe("DIV");
      expect(el.querySelector('[role="checkbox"]')).not.toBeNull();
    }
    expect(screen.getByTestId("button-input-map-place-wh").tagName).toBe("BUTTON");
    expect(screen.getByTestId("button-input-map-place-cs").tagName).toBe("BUTTON");
  });
});

describe("Input Map — A1 layer checkboxes (transport-coal)", () => {
  it("renders Mines/Stations checkboxes and a Size-by-demand checkbox, but NO Show-inactive checkbox", () => {
    renderTransport();
    for (const testId of ["toggle-layer-mines", "toggle-layer-stations", "toggle-layer-size-by-demand"]) {
      const el = screen.getByTestId(testId);
      expect(el.tagName).toBe("DIV");
      expect(el.querySelector('[role="checkbox"]')).not.toBeNull();
    }
    expect(screen.queryByTestId("toggle-layer-show-inactive")).not.toBeInTheDocument();
  });
});

describe("Input Map — A1 layer checkboxes (two-echelon-gold-au)", () => {
  it("renders Refineries/Customers/Show-inactive checkboxes and a Size-by-demand checkbox", () => {
    renderTwoEchelon();
    for (const testId of ["toggle-layer-warehouses", "toggle-layer-customers", "toggle-layer-show-inactive", "toggle-layer-size-by-demand"]) {
      const el = screen.getByTestId(testId);
      expect(el.tagName).toBe("DIV");
      expect(el.querySelector('[role="checkbox"]')).not.toBeNull();
    }
    expect(screen.getByTestId("toggle-layer-warehouses")).toHaveTextContent("Refineries");
  });
});

// ── legend follows the live layer toggles ───────────────────────────────

describe("Input Map — MapLegend follows the live layer checkboxes", () => {
  it("toggling Customers off hides the demand-bucket legend rows; Warehouses stays unaffected", () => {
    renderPMedian();
    expect(screen.getAllByTestId(/^legend-demand-bucket-/).length).toBeGreaterThan(0);
    expect(screen.getByTestId("legend-status-active")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("toggle-layer-customers"));

    expect(screen.queryAllByTestId(/^legend-demand-bucket-/).length).toBe(0);
    expect(screen.getByTestId("legend-status-active")).toBeInTheDocument();
  });

  it("toggling Warehouses off hides the facility-status legend rows; demand buckets stay unaffected", () => {
    renderPMedian();
    expect(screen.getByTestId("legend-status-active")).toBeInTheDocument();
    expect(screen.getAllByTestId(/^legend-demand-bucket-/).length).toBeGreaterThan(0);

    fireEvent.click(screen.getByTestId("toggle-layer-warehouses"));

    expect(screen.queryByTestId("legend-status-active")).not.toBeInTheDocument();
    expect(screen.getAllByTestId(/^legend-demand-bucket-/).length).toBeGreaterThan(0);
  });
});

// ── A2: size-by-demand ───────────────────────────────────────────────────

describe("Input Map — A2 size customers by demand", () => {
  it("defaults ON: customer bubbles vary in size across a spread population", () => {
    const { container } = renderPMedian();
    const widths = Array.from(container.querySelectorAll(".cs-marker svg")).map((svg) => Number(svg.getAttribute("width")));
    expect(new Set(widths).size).toBeGreaterThan(1);
  });

  it("toggling OFF fixes every customer marker at FIXED_CUSTOMER_RADIUS (6px, svg width 16) regardless of demand", () => {
    const { container } = renderPMedian();
    fireEvent.click(screen.getByTestId("toggle-layer-size-by-demand"));
    const widths = Array.from(container.querySelectorAll(".cs-marker svg")).map((svg) => Number(svg.getAttribute("width")));
    expect(widths.length).toBeGreaterThan(0);
    for (const w of widths) expect(w).toBe(16); // Math.ceil(6*2)+4
  });

  it("toggling OFF also fixes transport-coal STATION markers (a demand-bearing role sharing the same EntityMarkers customer slot)", () => {
    const { container } = renderTransport();
    fireEvent.click(screen.getByTestId("toggle-layer-size-by-demand"));
    const widths = Array.from(container.querySelectorAll(".cs-marker svg")).map((svg) => Number(svg.getAttribute("width")));
    expect(widths.length).toBeGreaterThan(0);
    for (const w of widths) expect(w).toBe(16);
  });

  it("hides the legend's demand-bucket section entirely when OFF", () => {
    renderPMedian();
    expect(screen.getAllByTestId(/^legend-demand-bucket-/).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByTestId("toggle-layer-size-by-demand"));
    expect(screen.queryAllByTestId(/^legend-demand-bucket-/).length).toBe(0);
  });
});

// ── two-echelon fixed mine under the Refineries layer ────────────────────

describe("Input Map — two-echelon fixed mine is gated by the Refineries layer checkbox", () => {
  // react-leaflet's `Marker` doesn't forward an arbitrary `data-testid` prop
  // onto the DOM icon element it imperatively creates (same reason every
  // other file in this suite locates markers via `.leaflet-marker-icon`
  // querySelectorAll, not getByTestId) — assert via total marker COUNT
  // (mine + refinery + customer, all real react-leaflet markers) instead.
  it("disabling Refineries hides both the refinery marker(s) and the fixed mine marker", () => {
    const { container } = renderTwoEchelon();
    const before = container.querySelectorAll(".leaflet-marker-pane .leaflet-marker-icon");
    // mine (bare Marker) + 1 refinery (.wh-marker) + 1 customer (.cs-marker).
    expect(before.length).toBe(3);
    expect(container.querySelectorAll(".wh-marker").length).toBe(1);

    fireEvent.click(screen.getByTestId("toggle-layer-warehouses"));

    const after = container.querySelectorAll(".leaflet-marker-pane .leaflet-marker-icon");
    // mine AND refinery both gone — only the customer marker remains.
    expect(after.length).toBe(1);
    expect(container.querySelectorAll(".wh-marker").length).toBe(0);
    expect(container.querySelectorAll(".cs-marker").length).toBe(1);
  });

  it("Customers stay visible while Refineries (and the mine) are hidden", () => {
    const { container } = renderTwoEchelon();
    fireEvent.click(screen.getByTestId("toggle-layer-warehouses"));
    expect(container.querySelectorAll(".cs-marker").length).toBeGreaterThan(0);
  });
});
