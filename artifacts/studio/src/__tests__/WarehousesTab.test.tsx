import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { WarehousesTab } from "@/components/workspace/tabs/WarehousesTab";

const warehouses = [
  { id: "CHI", city: "Chicago", state: "IL", lat: 41.88, lng: -87.62 },
  { id: "LA", city: "Los Angeles", state: "CA", lat: 34.05, lng: -118.24 },
];

describe("WarehousesTab", () => {
  it("renders the real WarehouseTable with the dataset's warehouses (not a placeholder)", () => {
    render(<WarehousesTab warehouses={warehouses} overrides={[]} capacityMode="none" onChange={vi.fn()} />);
    expect(screen.getByText("CHI")).toBeInTheDocument();
    expect(screen.getByText("Chicago, IL")).toBeInTheDocument();
    expect(screen.getByText("LA")).toBeInTheDocument();
    expect(screen.queryByTestId("tab-content-placeholder")).not.toBeInTheDocument();
  });

  it("applies DD-6's label mapping (Potential / Fixed-Open / Inactive), not the raw enum", () => {
    render(<WarehousesTab warehouses={warehouses} overrides={[]} capacityMode="none" onChange={vi.fn()} />);
    expect(screen.getAllByText("Potential").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Fixed-Open").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Inactive").length).toBeGreaterThan(0);
    expect(screen.queryByText("Active")).not.toBeInTheDocument();
    expect(screen.queryByText("Forced open")).not.toBeInTheDocument();
  });

  it("calls onChange with an upserted override when a status button is clicked", () => {
    const onChange = vi.fn();
    render(<WarehousesTab warehouses={warehouses} overrides={[]} capacityMode="none" onChange={onChange} />);
    fireEvent.click(screen.getByTestId("button-wh-CHI-forced_open"));
    expect(onChange).toHaveBeenCalledWith([{ id: "CHI", status: "forced_open", capacity: undefined }]);
  });

  it("shows the Capacity column only when capacityMode is per_wh", () => {
    const { rerender } = render(
      <WarehousesTab warehouses={warehouses} overrides={[]} capacityMode="none" onChange={vi.fn()} />,
    );
    expect(screen.queryByText("Capacity")).not.toBeInTheDocument();
    rerender(<WarehousesTab warehouses={warehouses} overrides={[]} capacityMode="per_wh" onChange={vi.fn()} />);
    expect(screen.getByText("Capacity")).toBeInTheDocument();
  });

  it("filters out mine-kind candidates (not a facility-location choice)", () => {
    const withMine = [...warehouses, { id: "MINE1", city: "Kalgoorlie", state: "WA", lat: -30.7, lng: 121.4, kind: "mine" as const }];
    render(<WarehousesTab warehouses={withMine} overrides={[]} capacityMode="none" onChange={vi.fn()} />);
    expect(screen.queryByText("MINE1")).not.toBeInTheDocument();
  });

  it("shows an empty state when the dataset has no warehouse candidates", () => {
    render(<WarehousesTab warehouses={[]} overrides={[]} capacityMode="none" onChange={vi.fn()} />);
    expect(screen.getByTestId("warehouses-tab-empty")).toBeInTheDocument();
  });
});
