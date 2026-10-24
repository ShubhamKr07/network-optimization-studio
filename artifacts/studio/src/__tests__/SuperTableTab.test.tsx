import { describe, it, expect, vi } from "vitest";
import { useState } from "react";
import { render, screen, fireEvent, within } from "@testing-library/react";
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
    fireEvent.change(screen.getByTestId('super-plantProducts-["p1","k1"]-capacity'), { target: { value: "9" } });
    expect(onChange).toHaveBeenCalledWith([{ ...rows[0], capacity: 9 }, rows[1]]);
  });
  it("composite keys are collision-free when an id contains '|'", () => {
    const onChange = vi.fn();
    const clash = [
      { plantId: "a|b", productId: "c", capacity: 1, costPerUnit: 0 },
      { plantId: "a", productId: "b|c", capacity: 2, costPerUnit: 0 },
    ];
    render(<SuperTableTab table="plantProducts" rows={clash} onChange={onChange} readOnly={false} options={options} />);
    fireEvent.click(screen.getByTestId('super-plantProducts-["a|b","c"]-delete'));
    expect(onChange).toHaveBeenCalledWith([clash[1]]);
    expect(screen.getByTestId('super-plantProducts-["a","b|c"]-delete')).toBeInTheDocument();
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
    fireEvent.click(screen.getByTestId('super-plantProducts-["p1","k1"]-delete'));
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
    it("QFX-4 regression: sorted descending, an edit and a delete each hit the intended underlying row", () => {
      const three = [
        { plantId: "p1", productId: "k1", capacity: 5, costPerUnit: 1 },
        { plantId: "p1", productId: "k2", capacity: 7, costPerUnit: 2 },
        { plantId: "p1", productId: "k3", capacity: 6, costPerUnit: 3 },
      ];
      const spy = vi.fn();
      function Harness() {
        const [rs, setRs] = useState<Record<string, unknown>[]>(three);
        return <SuperTableTab table="plantProducts" rows={rs} onChange={next => { spy(next); setRs(next); }} readOnly={false}
          options={{ productIds: ["k1", "k2", "k3"], plantIds: ["p1"] }} />;
      }
      render(<Harness />);
      const order = () => screen.getAllByTestId(/^super-row-plantProducts-/).map(tr => tr.getAttribute("data-testid"));
      const cap = screen.getByRole("columnheader", { name: "Capacity" });
      fireEvent.click(within(cap).getByRole("button"));
      fireEvent.click(within(cap).getByRole("button"));
      expect(cap).toHaveAttribute("aria-sort", "descending");
      expect(order()).toEqual([
        'super-row-plantProducts-["p1","k2"]', 'super-row-plantProducts-["p1","k3"]', 'super-row-plantProducts-["p1","k1"]',
      ]);

      // Edit the row DISPLAYED second (k3 = original index 2), not original index 1.
      fireEvent.change(screen.getByTestId('super-plantProducts-["p1","k3"]-capacity'), { target: { value: "1" } });
      expect(spy).toHaveBeenLastCalledWith([three[0], three[1], { ...three[2], capacity: 1 }]);
      expect(order()).toEqual([
        'super-row-plantProducts-["p1","k2"]', 'super-row-plantProducts-["p1","k1"]', 'super-row-plantProducts-["p1","k3"]',
      ]);

      // Delete the row DISPLAYED first (k2 = original index 1), not original index 0.
      fireEvent.click(screen.getByTestId('super-plantProducts-["p1","k2"]-delete'));
      expect(spy).toHaveBeenLastCalledWith([three[0], { ...three[2], capacity: 1 }]);
      expect(order()).toEqual(['super-row-plantProducts-["p1","k1"]', 'super-row-plantProducts-["p1","k3"]']);
    });

    it("the delete column header is not sortable", () => {
      render(<SuperTableTab table="plantProducts" rows={rows} onChange={vi.fn()} readOnly={false} options={options} />);
      const heads = screen.getAllByRole("columnheader");
      expect(within(heads[heads.length - 1]).queryByRole("button")).toBeNull();
      expect(heads[heads.length - 1]).not.toHaveAttribute("aria-sort");
    });
});

describe("SuperDistancesTab", () => {
  const props = { overrides: [], plantIds: ["p1"], warehouseIds: ["w1"], customerIds: ["c1"], readOnly: false };
  it("method change patches distanceMethod; factor disabled under haversine", () => {
    const onChange = vi.fn();
    render(<SuperDistancesTab onFetchRoad={() => {}} fetchDisabledReason={null} {...props} distanceMethod="haversine" circuityFactor={1.17} onChange={onChange} />);
    expect(screen.getByTestId("super-circuity-factor")).toBeDisabled();
    fireEvent.change(screen.getByTestId("super-distance-method"), { target: { value: "circuity" } });
    expect(onChange).toHaveBeenCalledWith({ distanceMethod: "circuity" });
  });
  it("factor is enabled under circuity and out-of-range values are not committed", () => {
    const onChange = vi.fn();
    render(<SuperDistancesTab onFetchRoad={() => {}} fetchDisabledReason={null} {...props} distanceMethod="circuity" circuityFactor={1.17} onChange={onChange} />);
    const f = screen.getByTestId("super-circuity-factor");
    expect(f).toBeEnabled();
    fireEvent.change(f, { target: { value: "5" } });
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.change(f, { target: { value: "1.5" } });
    expect(onChange).toHaveBeenCalledWith({ circuityFactor: 1.5 });
  });
});
