import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StationTable } from "@/components/tables/StationTable";

const stations = [
  { id: "LAX", city: "Los Angeles", state: "CA", lat: 34.0522, lng: -118.2437 },
  { id: "CHI", city: "Chicago", state: "IL", lat: 41.8781, lng: -87.6298 },
];

describe("StationTable", () => {
  it("renders every station with an empty demand input by default", () => {
    render(<StationTable stations={stations} overrides={[]} onChange={vi.fn()} />);
    expect(screen.getByTestId("input-station-demand-LAX")).toHaveValue(null);
    expect(screen.getByTestId("input-station-demand-CHI")).toHaveValue(null);
  });

  it("calls onChange with the new override when a demand is typed", async () => {
    const onChange = vi.fn();
    render(<StationTable stations={stations} overrides={[]} onChange={onChange} />);
    await userEvent.type(screen.getByTestId("input-station-demand-LAX"), "1000000");
    expect(onChange).toHaveBeenLastCalledWith([{ id: "LAX", demand: 1000000 }]);
  });

  it("removes the override when the input is cleared back to empty", async () => {
    const onChange = vi.fn();
    render(<StationTable stations={stations} overrides={[{ id: "LAX", demand: 1000000 }]} onChange={onChange} />);
    await userEvent.clear(screen.getByTestId("input-station-demand-LAX"));
    expect(onChange).toHaveBeenLastCalledWith([]);
  });

  it("renders City/State/Lat/Lng as separate columns, and Zip only when present", () => {
    const withZip = [{ id: "S1", city: "Los Angeles", state: "CA", lat: 34.0522, lng: -118.2437, zip: "90001" }];
    const { rerender } = render(<StationTable stations={withZip} overrides={[]} onChange={() => {}} />);
    expect(screen.getByText("Los Angeles")).toBeInTheDocument();
    expect(screen.getByText("CA")).toBeInTheDocument();
    expect(screen.getByText("34.0522")).toBeInTheDocument();
    expect(screen.getByText("90001")).toBeInTheDocument();

    const noZip = [{ id: "S2", city: "Chicago", state: "IL", lat: 41.8781, lng: -87.6298 }];
    rerender(<StationTable stations={noZip} overrides={[]} onChange={() => {}} />);
    expect(screen.queryByText("Zip")).not.toBeInTheDocument();
  });
});
