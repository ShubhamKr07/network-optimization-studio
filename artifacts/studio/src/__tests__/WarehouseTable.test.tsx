import { describe, it, expect, vi } from "vitest";
import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { WarehouseTable } from "@/components/tables/WarehouseTable";
import type { WarehouseOverride } from "@/components/tables/WarehouseTable";

const warehouses = [
  { id: "CHI", city: "Chicago", state: "IL", lat: 41.8781, lng: -87.6298 },
  { id: "LA", city: "Los Angeles", state: "CA", lat: 34.0522, lng: -118.2437 },
];

// Simulates real usage (Studio.tsx re-renders with the updated overrides on
// every onChange, via setLocalConfig).
function StatefulWarehouseTable(props: { capacityMode: "none" | "uniform" | "per_wh"; onChangeSpy: (next: WarehouseOverride[]) => void }) {
  const [overrides, setOverrides] = useState<WarehouseOverride[]>([]);
  return (
    <WarehouseTable
      warehouses={warehouses}
      overrides={overrides}
      capacityMode={props.capacityMode}
      onChange={next => { setOverrides(next); props.onChangeSpy(next); }}
    />
  );
}

describe("WarehouseTable", () => {
  it("renders one row per warehouse with id and city/state", () => {
    render(<WarehouseTable warehouses={warehouses} overrides={[]} capacityMode="uniform" onChange={vi.fn()} />);
    expect(screen.getByText("CHI")).toBeInTheDocument();
    expect(screen.getByText("Chicago")).toBeInTheDocument();
    expect(screen.getByText("IL")).toBeInTheDocument();
    expect(screen.getByText("LA")).toBeInTheDocument();
  });

  it("renders City/State/Lat/Lng as separate columns, and Zip only when present", () => {
    const withZip = [{ id: "ALN", city: "Allentown", state: "PA", lat: 40.6028, lng: -75.4704, zip: "18101" }];
    const { rerender } = render(
      <WarehouseTable warehouses={withZip} overrides={[]} capacityMode="none" onChange={() => {}} />
    );
    expect(screen.getByText("Allentown")).toBeInTheDocument();
    expect(screen.getByText("PA")).toBeInTheDocument();
    expect(screen.getByText("40.6028")).toBeInTheDocument();
    expect(screen.getByText("18101")).toBeInTheDocument();

    const noZip = [{ id: "ATL", city: "Atlanta", state: "GA", lat: 33.7537, lng: -84.3895 }];
    rerender(<WarehouseTable warehouses={noZip} overrides={[]} capacityMode="none" onChange={() => {}} />);
    expect(screen.queryByText("Zip")).not.toBeInTheDocument();
  });

  it("does NOT show a Capacity column when capacityMode is not per_wh", () => {
    render(<WarehouseTable warehouses={warehouses} overrides={[]} capacityMode="uniform" onChange={vi.fn()} />);
    expect(screen.queryByText("Capacity")).not.toBeInTheDocument();
  });

  it("shows a Capacity column when capacityMode is per_wh", () => {
    render(<WarehouseTable warehouses={warehouses} overrides={[]} capacityMode="per_wh" onChange={vi.fn()} />);
    expect(screen.getByText("Capacity")).toBeInTheDocument();
  });

  it("applies DD-6's label mapping (Potential / Fixed-Open / Inactive) — this is the single mapping constant, not re-implemented per caller", () => {
    render(<WarehouseTable warehouses={warehouses} overrides={[]} capacityMode="uniform" onChange={vi.fn()} />);
    expect(screen.getAllByText("Potential").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Fixed-Open").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Inactive").length).toBeGreaterThan(0);
    expect(screen.queryByText("Active")).not.toBeInTheDocument();
    expect(screen.queryByText("Forced open")).not.toBeInTheDocument();
  });

  it("clicking Forced open calls onChange with an upserted override", async () => {
    const onChange = vi.fn();
    render(<WarehouseTable warehouses={warehouses} overrides={[]} capacityMode="uniform" onChange={onChange} />);
    await userEvent.click(screen.getByTestId("button-wh-CHI-forced_open"));
    expect(onChange).toHaveBeenCalledWith([{ id: "CHI", status: "forced_open", capacity: undefined }]);
  });

  it("edit persists: setting a per-warehouse capacity round-trips through overrides prop", async () => {
    const onChangeSpy = vi.fn();
    render(<StatefulWarehouseTable capacityMode="per_wh" onChangeSpy={onChangeSpy} />);
    await userEvent.type(screen.getByTestId("input-wh-capacity-CHI"), "50000");
    expect(screen.getByTestId("input-wh-capacity-CHI")).toHaveValue(50000);
    expect(onChangeSpy).toHaveBeenLastCalledWith([{ id: "CHI", status: "active", capacity: 50000 }]);
  });

  it("returning status to active with no capacity removes the override entirely", async () => {
    const onChange = vi.fn();
    const overrides: WarehouseOverride[] = [{ id: "CHI", status: "forced_open" }];
    render(<WarehouseTable warehouses={warehouses} overrides={overrides} capacityMode="uniform" onChange={onChange} />);
    await userEvent.click(screen.getByTestId("button-wh-CHI-active"));
    expect(onChange).toHaveBeenCalledWith([]);
  });
});
