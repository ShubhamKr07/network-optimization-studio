import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MineTable } from "@/components/tables/MineTable";

const mines = [
  { id: "KY", city: "Pikeville", state: "KY" },
  { id: "WY", city: "Rock Springs", state: "WY" },
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
});
