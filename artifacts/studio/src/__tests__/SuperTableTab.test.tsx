import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SuperTableTab } from "@/components/workspace/super/SuperTableTab";
import { SuperDistancesTab } from "@/components/workspace/super/SuperDistancesTab";

const options = { productIds: ["k1", "k2"], plantIds: ["p1"], customerIds: ["c1"] };
const rows = [
  { plantId: "p1", productId: "k1", capacity: 5, costPerUnit: 1 },
  { plantId: "p1", productId: "k2", capacity: 7, costPerUnit: 2 },
];

describe("SuperTableTab", () => {
  it("editing a capacity cell calls onChange with the new number", () => {
    const onChange = vi.fn();
    render(<SuperTableTab table="plantProducts" rows={rows} onChange={onChange} readOnly={false} options={options} />);
    fireEvent.change(screen.getByTestId("super-plantProducts-p1|k1-capacity"), { target: { value: "9" } });
    expect(onChange).toHaveBeenCalledWith([{ ...rows[0], capacity: 9 }, rows[1]]);
  });
  it("+ Add row appends one row", () => {
    const onChange = vi.fn();
    render(<SuperTableTab table="plantProducts" rows={rows} onChange={onChange} readOnly={false} options={options} />);
    fireEvent.click(screen.getByTestId("super-plantProducts-add"));
    expect(onChange.mock.calls[0][0]).toHaveLength(3);
    expect(onChange.mock.calls[0][0][2]).toEqual({ plantId: "p1", productId: "k1", capacity: 0, costPerUnit: 0 });
  });
  it("delete on a composite table drops exactly that row", () => {
    const onChange = vi.fn();
    render(<SuperTableTab table="plantProducts" rows={rows} onChange={onChange} readOnly={false} options={options} />);
    fireEvent.click(screen.getByTestId("super-plantProducts-p1|k1-delete"));
    expect(onChange).toHaveBeenCalledWith([rows[1]]);
  });
  it("entity delete is delegated to onDelete, and readOnly disables everything", () => {
    const onDelete = vi.fn();
    const { rerender } = render(<SuperTableTab table="products" rows={[{ id: "k1", name: "K" }]} onChange={vi.fn()} onDelete={onDelete} readOnly={false} />);
    fireEvent.click(screen.getByTestId("super-products-k1-delete"));
    expect(onDelete).toHaveBeenCalledWith({ id: "k1", name: "K" });
    rerender(<SuperTableTab table="products" rows={[{ id: "k1", name: "K" }]} onChange={vi.fn()} readOnly />);
    expect(screen.getByTestId("super-products-add")).toBeDisabled();
    expect(screen.getByTestId("super-products-k1-delete")).toBeDisabled();
  });
});

describe("SuperDistancesTab", () => {
  const props = { overrides: [], plantIds: ["p1"], warehouseIds: ["w1"], customerIds: ["c1"], readOnly: false };
  it("method change patches distanceMethod; factor disabled under haversine", () => {
    const onChange = vi.fn();
    render(<SuperDistancesTab {...props} distanceMethod="haversine" circuityFactor={1.17} onChange={onChange} />);
    expect(screen.getByTestId("super-circuity-factor")).toBeDisabled();
    fireEvent.change(screen.getByTestId("super-distance-method"), { target: { value: "circuity" } });
    expect(onChange).toHaveBeenCalledWith({ distanceMethod: "circuity" });
  });
  it("factor is enabled under circuity and out-of-range values are not committed", () => {
    const onChange = vi.fn();
    render(<SuperDistancesTab {...props} distanceMethod="circuity" circuityFactor={1.17} onChange={onChange} />);
    const f = screen.getByTestId("super-circuity-factor");
    expect(f).toBeEnabled();
    fireEvent.change(f, { target: { value: "5" } });
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.change(f, { target: { value: "1.5" } });
    expect(onChange).toHaveBeenCalledWith({ circuityFactor: 1.5 });
  });
});
