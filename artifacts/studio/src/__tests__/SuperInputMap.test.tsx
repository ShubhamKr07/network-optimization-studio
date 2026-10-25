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
  plants: [{ id: "PL-1", city: "Ashland", state: "KY", lat: 38.4, lng: -82.6 }],
  warehouses: [{ id: "WH-1", lat: 33.4, lng: -112.0, status: "forced_open" },
               { id: "WH-2", lat: 40.0, lng: -75.0, status: "inactive" }],
  customers: [{ id: "C-1", lat: 34.0, lng: -118.2, status: "excluded" }],
  plantProducts: [], demand: [{ customerId: "C-1", productId: "K1", demand: 5 }, { customerId: "C-1", productId: "K2", demand: 7 }],
  distanceOverrides: [],
  ...over,
});
const cb = () => ({ onInputsChange: vi.fn(), onRequestDelete: vi.fn(), readOnly: false });
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
    const { container } = render(<InputMapTab mode="super" inputs={net()} fitKey={0} {...cb()} />);
    expect(screen.getByTestId("super-map-toolbar")).toBeInTheDocument();
    expect(screen.getByTestId("map-legend")).toBeInTheDocument();
    expect(screen.queryByTestId("jade-map-toolbar")).not.toBeInTheDocument();
    // showInactive defaults true for Super, so all statuses render
    expect(container.querySelectorAll(".leaflet-marker-pane .leaflet-marker-icon")).toHaveLength(4);
  });
  it("layer toggles hide plants / warehouses / customers", () => {
    const { container } = render(<InputMapTab mode="super" inputs={net()} fitKey={0} {...cb()} />);
    fireEvent.click(screen.getByTestId("toggle-layer-plants"));
    expect(container.querySelector(".pl-marker")).toBeNull();
    fireEvent.click(screen.getByTestId("toggle-layer-warehouses"));
    expect(container.querySelector(".wh-marker")).toBeNull();
    fireEvent.click(screen.getByTestId("toggle-layer-customers"));
    expect(container.querySelector(".cs-marker")).toBeNull();
  });
  it("fits all points on mount (40 px, max zoom 10) and refits only when fitKey changes", () => {
    const fit = vi.spyOn(L.Map.prototype, "fitBounds").mockImplementation(function (this: L.Map) { return this; });
    const { rerender } = render(<InputMapTab mode="super" inputs={net()} fitKey={0} {...cb()} />);
    expect(fit).toHaveBeenCalledTimes(1);
    expect(fit.mock.calls[0][0]).toHaveLength(4);
    expect(fit.mock.calls[0][1]).toEqual({ padding: [40, 40], maxZoom: 10 });
    const moved = net({ plants: [{ id: "PL-1", lat: 10, lng: 10 }] });
    rerender(<InputMapTab mode="super" inputs={moved} fitKey={0} {...cb()} />);
    expect(fit).toHaveBeenCalledTimes(1);
    rerender(<InputMapTab mode="super" inputs={moved} fitKey={1} {...cb()} />);
    expect(fit).toHaveBeenCalledTimes(2);
  });
  it("one point -> setView(point, 8); no points -> world view", () => {
    const view = vi.spyOn(L.Map.prototype, "setView");
    const one = net({ plants: [], warehouses: [], customers: [{ id: "C-1", lat: 34, lng: -118, status: "active" }] });
    render(<InputMapTab mode="super" inputs={one} fitKey={0} {...cb()} />);
    expect(view).toHaveBeenCalledWith([34, -118], 8);
    view.mockClear();
    render(<InputMapTab mode="super" inputs={net({ plants: [], warehouses: [], customers: [] })} fitKey={0} {...cb()} />);
    // MapContainer's own creation call is one; FitToPoints' empty-points branch must add a second.
    expect(view.mock.calls.filter(([c, z]) => z === 2 && (c as number[])[0] === 20 && (c as number[])[1] === 0)).toHaveLength(2);
  });
});

const mount = (inputs = net(), readOnly = false) => {
  const onInputsChange = vi.fn(), onRequestDelete = vi.fn();
  const view = render(<InputMapTab mode="super" inputs={inputs} fitKey={0} onInputsChange={onInputsChange} onRequestDelete={onRequestDelete} readOnly={readOnly} />);
  return { ...view, onInputsChange, onRequestDelete };
};
const markers = (c: HTMLElement) => c.querySelectorAll(".leaflet-marker-pane .leaflet-marker-icon");

describe("SuperInputMap actions", () => {
  it("right-click empty map -> Add warehouse here -> dialog pre-filled WH-3 -> onInputsChange", () => {
    const { container, onInputsChange } = mount();
    fireEvent.contextMenu(container.querySelector(".leaflet-container")!, { clientX: 40, clientY: 40 });
    fireEvent.click(screen.getByTestId("map-add-menu-wh"));
    expect(screen.getByTestId("super-entity-id")).toHaveValue("WH-3");
    fireEvent.click(screen.getByTestId("super-entity-submit"));
    expect(onInputsChange.mock.calls[0][0].warehouses.at(-1)).toMatchObject({ id: "WH-3", status: "active" });
    expect(onInputsChange.mock.calls[0][0].warehouses.at(-1)).not.toHaveProperty("name");
  });
  it("Edit on a customer opens the dialog with its demand; submit replaces demand rows", () => {
    const { container, onInputsChange } = mount();
    fireEvent.contextMenu(markers(container)[3]);       // order: plants, warehouses, customers
    fireEvent.click(screen.getByTestId("map-action-edit"));
    expect(screen.getByTestId("super-entity-demand-K2")).toHaveValue(7);
    fireEvent.change(screen.getByTestId("super-entity-demand-K2"), { target: { value: "" } });
    fireEvent.click(screen.getByTestId("super-entity-submit"));
    expect(onInputsChange.mock.calls[0][0].demand).toEqual([{ customerId: "C-1", productId: "K1", demand: 5 }]);
  });
  it("Copy inserts immediately 0.05° east with no placement click and no refit", () => {
    const fit = vi.spyOn(L.Map.prototype, "fitBounds").mockImplementation(function (this: L.Map) { return this; });
    const { container, onInputsChange } = mount();
    const before = fit.mock.calls.length;
    fireEvent.contextMenu(markers(container)[0]);
    fireEvent.click(screen.getByTestId("map-action-copy"));
    expect(onInputsChange.mock.calls[0][0].plants.at(-1)).toMatchObject({ id: "PL-2", city: "Ashland", state: "KY", lng: -82.55 });
    expect(onInputsChange.mock.calls[0][0].plants.at(-1)).not.toHaveProperty("name");
    expect(fit.mock.calls.length).toBe(before);
  });
  it("Move -> click -> MoveConfirmDialog -> lat/lng written", () => {
    const { container, onInputsChange } = mount();
    fireEvent.contextMenu(markers(container)[1]);
    fireEvent.click(screen.getByTestId("map-action-move"));
    fireEvent.click(container.querySelector(".leaflet-container")!, { clientX: 20, clientY: 20 });
    fireEvent.click(screen.getByTestId("move-confirm-confirm"));
    const w = onInputsChange.mock.calls[0][0].warehouses[0];
    expect(w.id).toBe("WH-1");
    expect([w.lat, w.lng]).not.toEqual([33.4, -112.0]);
  });
  it("Delete hands off to the single D3 cascade confirmation on the FIRST click (menu confirm bypassed)", () => {
    const { container, onInputsChange, onRequestDelete } = mount();
    fireEvent.contextMenu(markers(container)[3]);
    fireEvent.click(screen.getByTestId("map-action-delete"));
    expect(onRequestDelete).toHaveBeenCalledWith("customers", "C-1");
    expect(onInputsChange).not.toHaveBeenCalled();
  });
  it("no action refits: add, move, copy and delete leave fitBounds untouched (R13)", () => {
    const fit = vi.spyOn(L.Map.prototype, "fitBounds").mockImplementation(function (this: L.Map) { return this; });
    const { container, rerender, onInputsChange } = mount();
    const calls = () => fit.mock.calls.length;
    const before = calls();
    const props = { fitKey: 0, onInputsChange, onRequestDelete: vi.fn(), readOnly: false } as const;
    // add
    fireEvent.contextMenu(container.querySelector(".leaflet-container")!, { clientX: 40, clientY: 40 });
    fireEvent.click(screen.getByTestId("map-add-menu-cs"));
    fireEvent.click(screen.getByTestId("super-entity-submit"));
    rerender(<InputMapTab mode="super" inputs={onInputsChange.mock.calls.at(-1)![0]} {...props} />);
    // move
    fireEvent.contextMenu(markers(container)[1]);
    fireEvent.click(screen.getByTestId("map-action-move"));
    fireEvent.click(container.querySelector(".leaflet-container")!, { clientX: 20, clientY: 20 });
    fireEvent.click(screen.getByTestId("move-confirm-confirm"));
    rerender(<InputMapTab mode="super" inputs={onInputsChange.mock.calls.at(-1)![0]} {...props} />);
    // copy
    fireEvent.contextMenu(markers(container)[0]);
    fireEvent.click(screen.getByTestId("map-action-copy"));
    rerender(<InputMapTab mode="super" inputs={onInputsChange.mock.calls.at(-1)![0]} {...props} />);
    // delete (the parent applies the cascade; simulate it by dropping the row)
    const last = onInputsChange.mock.calls.at(-1)![0] as SuperInputsLike;
    rerender(<InputMapTab mode="super" inputs={{ ...last, customers: last.customers.slice(1) }} {...props} />);
    expect(onInputsChange).toHaveBeenCalledTimes(3);
    expect(calls()).toBe(before);
  });
  it("the move dialog keeps identity: no regenerated code or nearest city is shown (decision b)", () => {
    const { container } = mount();
    fireEvent.contextMenu(markers(container)[1]);
    fireEvent.click(screen.getByTestId("map-action-move"));
    fireEvent.click(container.querySelector(".leaflet-container")!, { clientX: 20, clientY: 20 });
    expect(screen.getByTestId("move-confirm-identity-note")).toHaveTextContent("ID, city and state stay unchanged");
    expect(screen.queryByTestId("move-confirm-new-code")).not.toBeInTheDocument();
    expect(screen.queryByTestId("move-confirm-location")).not.toBeInTheDocument();
  });
  it("Escape cancels an armed move: no dialog on the next map click, bar gone", () => {
    const { container } = mount();
    fireEvent.contextMenu(markers(container)[1]);
    fireEvent.click(screen.getByTestId("map-action-move"));
    expect(screen.getByTestId("armed-status-bar")).toHaveTextContent("Esc to cancel");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByTestId("armed-status-bar")).not.toBeInTheDocument();
    fireEvent.click(container.querySelector(".leaflet-container")!, { clientX: 20, clientY: 20 });
    expect(screen.queryByTestId("move-confirm-dialog")).not.toBeInTheDocument();
  });
  it("the armed bar's Cancel button also disarms", () => {
    const { container } = mount();
    fireEvent.contextMenu(markers(container)[1]);
    fireEvent.click(screen.getByTestId("map-action-move"));
    fireEvent.click(screen.getByTestId("button-armed-cancel"));
    fireEvent.click(container.querySelector(".leaflet-container")!, { clientX: 20, clientY: 20 });
    expect(screen.queryByTestId("move-confirm-dialog")).not.toBeInTheDocument();
  });
  it("markers are draggable when editable and not draggable when readOnly", () => {
    const editable = mount();
    expect(editable.container.querySelectorAll(".leaflet-marker-draggable").length).toBeGreaterThan(0);
    editable.unmount();
    const ro = mount(net(), true);
    expect(ro.container.querySelectorAll(".leaflet-marker-draggable")).toHaveLength(0);
  });
  it("readOnly: no add menu, no action menu", () => {
    const { container } = mount(net(), true);
    fireEvent.contextMenu(container.querySelector(".leaflet-container")!);
    expect(screen.queryByTestId("map-add-menu")).not.toBeInTheDocument();
    fireEvent.contextMenu(markers(container)[0]);
    expect(screen.queryByTestId("map-action-menu")).not.toBeInTheDocument();
  });
});

describe("SuperInputMap details card (DU-3.1)", () => {
  it("left-click opens the card; Delete hands off on the FIRST click (confirmDelete=false)", () => {
    const { container, onRequestDelete } = mount();
    fireEvent.click(markers(container)[3]);
    expect(screen.getByTestId("map-details-card")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("map-details-action-delete"));
    expect(onRequestDelete).toHaveBeenCalledWith("customers", "C-1");
    expect(screen.queryByTestId("map-details-card")).not.toBeInTheDocument();
  });
  it("Edit from the card opens SuperEntityDialog", () => {
    const { container } = mount();
    fireEvent.click(markers(container)[3]);
    fireEvent.click(screen.getByTestId("map-details-action-edit"));
    expect(screen.getByTestId("super-entity-demand-K2")).toHaveValue(7);
  });
  it("readOnly: the card opens but has no actions row", () => {
    const { container } = mount(net(), true);
    fireEvent.click(markers(container)[3]);
    expect(screen.getByTestId("map-details-card")).toBeInTheDocument();
    expect(screen.queryByTestId("map-details-actions")).not.toBeInTheDocument();
  });
  it("a map click clears the selection", () => {
    const { container } = mount();
    fireEvent.click(markers(container)[3]);
    fireEvent.click(container.querySelector(".leaflet-container")!, { clientX: 20, clientY: 20 });
    expect(screen.queryByTestId("map-details-card")).not.toBeInTheDocument();
  });
});
