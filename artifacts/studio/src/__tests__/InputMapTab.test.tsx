import { render, screen, fireEvent, act } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

// Capture the click handler react-leaflet's useMapEvents receives, so tests
// can invoke it directly instead of needing a real Leaflet map click (jsdom
// can't produce one). This is the actual click-to-place flow under test,
// not a tautology about mount behavior.
let capturedClickHandler: ((e: { latlng: { lat: number; lng: number } }) => void) | null = null;
vi.mock("react-leaflet", async () => {
  const actual = await vi.importActual<typeof import("react-leaflet")>("react-leaflet");
  return {
    ...actual,
    useMapEvents: (handlers: { click: (e: { latlng: { lat: number; lng: number } }) => void }) => {
      capturedClickHandler = handlers.click;
      return null;
    },
    MapContainer: ({ children }: { children: React.ReactNode }) => <div data-testid="mock-map-container">{children}</div>,
    TileLayer: () => null,
    Marker: () => null,
    CircleMarker: () => <div data-testid="mock-circle-marker" />,
  };
});

import { InputMapTab } from "@/components/workspace/tabs/InputMapTab";

const countryBounds = { sw: [24.5, -125] as [number, number], ne: [49.4, -66.9] as [number, number] };
const placementOptions = [{ key: "warehouses", label: "Warehouse" }, { key: "customers", label: "Customer" }];

describe("InputMapTab", () => {
  it("renders a placement toggle defaulting to the first option", () => {
    render(<InputMapTab mode="legacy" countryBounds={countryBounds} pins={[]} placementOptions={placementOptions} onPlacePoint={vi.fn()} />);
    expect(screen.getByTestId("button-input-map-place-warehouses")).toHaveClass("bg-primary");
  });

  it("switches the active placement kind on toggle click", () => {
    render(<InputMapTab mode="legacy" countryBounds={countryBounds} pins={[]} placementOptions={placementOptions} onPlacePoint={vi.fn()} />);
    fireEvent.click(screen.getByTestId("button-input-map-place-customers"));
    expect(screen.getByTestId("button-input-map-place-customers")).toHaveClass("bg-primary");
  });

  it("drops a draft marker on click but does not call onPlacePoint until Confirm", () => {
    const onPlacePoint = vi.fn();
    render(<InputMapTab mode="legacy" countryBounds={countryBounds} pins={[]} placementOptions={placementOptions} onPlacePoint={onPlacePoint} />);
    act(() => capturedClickHandler!({ latlng: { lat: 40.1, lng: -75.2 } }));
    expect(screen.getByTestId("input-map-draft-panel")).toBeInTheDocument();
    expect(onPlacePoint).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("button-input-map-confirm"));
    expect(onPlacePoint).toHaveBeenCalledWith(40.1, -75.2, "warehouses");
  });

  it("Cancel removes the draft marker without calling onPlacePoint", () => {
    const onPlacePoint = vi.fn();
    render(<InputMapTab mode="legacy" countryBounds={countryBounds} pins={[]} placementOptions={placementOptions} onPlacePoint={onPlacePoint} />);
    act(() => capturedClickHandler!({ latlng: { lat: 40.1, lng: -75.2 } }));
    fireEvent.click(screen.getByTestId("button-input-map-cancel"));
    expect(screen.queryByTestId("input-map-draft-panel")).not.toBeInTheDocument();
    expect(onPlacePoint).not.toHaveBeenCalled();
  });

  it("Confirm uses whichever placement kind is active at click time", () => {
    const onPlacePoint = vi.fn();
    render(<InputMapTab mode="legacy" countryBounds={countryBounds} pins={[]} placementOptions={placementOptions} onPlacePoint={onPlacePoint} />);
    fireEvent.click(screen.getByTestId("button-input-map-place-customers"));
    act(() => capturedClickHandler!({ latlng: { lat: 10, lng: 20 } }));
    fireEvent.click(screen.getByTestId("button-input-map-confirm"));
    expect(onPlacePoint).toHaveBeenCalledWith(10, 20, "customers");
  });
});
