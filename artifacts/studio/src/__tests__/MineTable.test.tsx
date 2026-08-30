import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MineTable } from "@/components/tables/MineTable";

const mines = [
  { id: "KY", city: "Pikeville", state: "KY", lat: 37.4797, lng: -82.5188 },
  { id: "WY", city: "Rock Springs", state: "WY", lat: 41.5875, lng: -109.2029 },
];

describe("MineTable", () => {
  it("renders every mine with an empty capacity input by default", () => {
    render(<MineTable mines={mines} overrides={[]} onChange={vi.fn()} />);
    expect(screen.getByTestId("input-mine-capacity-KY")).toHaveValue(null);
    expect(screen.getByTestId("input-mine-capacity-WY")).toHaveValue(null);
  });

  it("calls onChange with the new override when a capacity is typed", async () => {
    const onChange = vi.fn();
    render(<MineTable mines={mines} overrides={[]} onChange={onChange} />);
    await userEvent.type(screen.getByTestId("input-mine-capacity-KY"), "1000000");
    expect(onChange).toHaveBeenLastCalledWith([{ id: "KY", capacity: 1000000 }]);
  });

  it("removes the override when the input is cleared back to empty", async () => {
    const onChange = vi.fn();
    render(<MineTable mines={mines} overrides={[{ id: "KY", capacity: 1000000 }]} onChange={onChange} />);
    await userEvent.clear(screen.getByTestId("input-mine-capacity-KY"));
    expect(onChange).toHaveBeenLastCalledWith([]);
  });

  it("renders City/State/Lat/Lng as separate columns, and Zip only when present", () => {
    const withZip = [{ id: "M1", city: "Pikeville", state: "KY", lat: 37.4797, lng: -82.5188, zip: "41501" }];
    const { rerender } = render(<MineTable mines={withZip} overrides={[]} onChange={() => {}} />);
    expect(screen.getByText("Pikeville")).toBeInTheDocument();
    expect(screen.getByText("KY")).toBeInTheDocument();
    expect(screen.getByText("37.4797")).toBeInTheDocument();
    expect(screen.getByText("41501")).toBeInTheDocument();

    const noZip = [{ id: "M2", city: "Rock Springs", state: "WY", lat: 41.5875, lng: -109.2029 }];
    rerender(<MineTable mines={noZip} overrides={[]} onChange={() => {}} />);
    expect(screen.queryByText("Zip")).not.toBeInTheDocument();
  });
});
