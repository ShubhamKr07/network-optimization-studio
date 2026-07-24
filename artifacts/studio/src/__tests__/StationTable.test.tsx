import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StationTable } from "@/components/tables/StationTable";

const stations = [
  { id: "LAX", city: "Los Angeles", state: "CA" },
  { id: "CHI", city: "Chicago", state: "IL" },
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
});
