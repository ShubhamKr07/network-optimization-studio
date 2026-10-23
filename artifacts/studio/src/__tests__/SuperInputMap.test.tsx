import { describe, it, expect, vi, afterEach } from "vitest";
import { render as rtlRender, screen, fireEvent } from "@testing-library/react";
import L from "leaflet";
import { UnitProvider } from "@/contexts/UnitContext";
import { InputMapTab } from "@/components/workspace/tabs/InputMapTab";
import { superMapRows, type SuperInputsLike } from "@/lib/superNetwork";

const render = (ui: Parameters<typeof rtlRender>[0]) => rtlRender(ui, { wrapper: UnitProvider });
vi.mock("@workspace/api-client-react", () => ({ useListModels: () => ({ data: [] }) }));

const net = (over: Partial<SuperInputsLike> = {}): SuperInputsLike => ({
  products: [{ id: "K1", name: "K1" }, { id: "K2", name: "K2" }],
  plants: [{ id: "PL-1", name: "Plant", city: "Ashland", state: "KY", lat: 38.4, lng: -82.6 }],
  warehouses: [{ id: "WH-1", name: "Wh", lat: 33.4, lng: -112.0, status: "forced_open" },
               { id: "WH-2", name: "Wh2", lat: 40.0, lng: -75.0, status: "inactive" }],
  customers: [{ id: "C-1", name: "Cust", lat: 34.0, lng: -118.2, status: "excluded" }],
  plantProducts: [], demand: [{ customerId: "C-1", productId: "K1", demand: 5 }, { customerId: "C-1", productId: "K2", demand: 7 }],
  distanceOverrides: [],
  ...over,
});
afterEach(() => vi.restoreAllMocks());

describe("superMapRows", () => {
  it("projects rows with id as displayCode, every row scenario-owned, demand summed", () => {
    const r = superMapRows(net());
    expect(r.plants[0]).toMatchObject({ id: "PL-1", displayCode: "PL-1", city: "Ashland", isAdded: true });
    expect(r.warehouses.map(w => w.status)).toEqual(["forced_open", "inactive"]);
    expect(r.customers[0]).toMatchObject({ displayCode: "C-1", demand: 12, excluded: true, city: "", isAdded: true });
  });
});

describe("InputMapTab mode=super", () => {
  it("renders the super toolbar, legend and one marker per location", () => {
    const { container } = render(<InputMapTab mode="super" inputs={net()} fitKey={0} />);
    expect(screen.getByTestId("super-map-toolbar")).toBeInTheDocument();
    expect(screen.getByTestId("map-legend")).toBeInTheDocument();
    expect(screen.queryByTestId("jade-map-toolbar")).not.toBeInTheDocument();
    // showInactive defaults true for Super, so all statuses render
    expect(container.querySelectorAll(".leaflet-marker-pane .leaflet-marker-icon")).toHaveLength(4);
  });
  it("layer toggles hide plants / warehouses / customers", () => {
    const { container } = render(<InputMapTab mode="super" inputs={net()} fitKey={0} />);
    fireEvent.click(screen.getByTestId("toggle-layer-plants"));
    expect(container.querySelector(".pl-marker")).toBeNull();
    fireEvent.click(screen.getByTestId("toggle-layer-warehouses"));
    expect(container.querySelector(".wh-marker")).toBeNull();
    fireEvent.click(screen.getByTestId("toggle-layer-customers"));
    expect(container.querySelector(".cs-marker")).toBeNull();
  });
  it("fits all points on mount (40 px, max zoom 10) and refits only when fitKey changes", () => {
    const fit = vi.spyOn(L.Map.prototype, "fitBounds").mockImplementation(function (this: L.Map) { return this; });
    const { rerender } = render(<InputMapTab mode="super" inputs={net()} fitKey={0} />);
    expect(fit).toHaveBeenCalledTimes(1);
    expect(fit.mock.calls[0][0]).toHaveLength(4);
    expect(fit.mock.calls[0][1]).toEqual({ padding: [40, 40], maxZoom: 10 });
    const moved = net({ plants: [{ id: "PL-1", name: "Plant", lat: 10, lng: 10 }] });
    rerender(<InputMapTab mode="super" inputs={moved} fitKey={0} />);
    expect(fit).toHaveBeenCalledTimes(1);
    rerender(<InputMapTab mode="super" inputs={moved} fitKey={1} />);
    expect(fit).toHaveBeenCalledTimes(2);
  });
  it("one point -> setView(point, 8); no points -> world view", () => {
    const view = vi.spyOn(L.Map.prototype, "setView");
    const one = net({ plants: [], warehouses: [], customers: [{ id: "C-1", name: "c", lat: 34, lng: -118, status: "active" }] });
    render(<InputMapTab mode="super" inputs={one} fitKey={0} />);
    expect(view).toHaveBeenCalledWith([34, -118], 8);
    view.mockClear();
    render(<InputMapTab mode="super" inputs={net({ plants: [], warehouses: [], customers: [] })} fitKey={0} />);
    // MapContainer's own creation call is one; FitToPoints' empty-points branch must add a second.
    expect(view.mock.calls.filter(([c, z]) => z === 2 && (c as number[])[0] === 20 && (c as number[])[1] === 0)).toHaveLength(2);
  });
});
