import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SuperAddRowDialog } from "@/components/workspace/super/SuperAddRowDialog";
import type { SuperInputsLike } from "@/lib/superNetwork";

const loc = (id: string) => ({ id, lat: 0, lng: 0 });
const base: SuperInputsLike = {
  products: [{ id: "K1", name: "Bolts" }], plants: [loc("P1")], warehouses: [loc("W1")], customers: [loc("C1")],
  plantProducts: [{ plantId: "P1", productId: "K1", capacity: 5, costPerUnit: 1 }], demand: [], distanceOverrides: [],
};
const options = (testId: string) => [...screen.getByTestId(testId).querySelectorAll("option")].map(o => o.value);

describe("SuperAddRowDialog", () => {
  it("is titled per tab; Add stays disabled until valid; errors show inline after editing; adds the parsed row", () => {
    const onAdd = vi.fn();
    render(<SuperAddRowDialog table="plants" network={base} onAdd={onAdd} onCancel={vi.fn()} />);
    expect(screen.getByRole("dialog", { name: "Add plant" })).toBeInTheDocument();
    expect(screen.getByTestId("super-add-id")).toHaveValue("PL-1");
    expect(screen.queryByTestId("super-add-name")).toBeNull();          // QFX-7: no location name
    expect(screen.getByTestId("super-add-confirm")).toBeDisabled();
    expect(screen.queryByTestId("super-add-lat-error")).toBeNull();     // untouched fields show no error
    fireEvent.change(screen.getByTestId("super-add-lat"), { target: { value: "95" } });
    expect(screen.getByTestId("super-add-lat-error")).toHaveTextContent("Must be between -90 and 90.");
    expect(screen.getByTestId("super-add-lat")).toHaveAttribute("aria-invalid", "true");
    fireEvent.change(screen.getByTestId("super-add-lat"), { target: { value: "-12.5" } });
    fireEvent.change(screen.getByTestId("super-add-lng"), { target: { value: "130" } });
    expect(screen.getByTestId("super-add-confirm")).toBeEnabled();
    fireEvent.click(screen.getByTestId("super-add-confirm"));
    expect(onAdd).toHaveBeenCalledWith({ id: "PL-1", lat: -12.5, lng: 130 });
  });

  it("warehouse and customer forms default Status to active and offer only the server's statuses", () => {
    render(<SuperAddRowDialog table="warehouses" network={base} onAdd={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByRole("dialog", { name: "Add warehouse" })).toBeInTheDocument();
    expect(screen.getByTestId("super-add-status")).toHaveValue("active");
    expect(options("super-add-status")).toEqual(["active", "forced_open", "inactive"]);
  });

  it("Distances: To lists warehouses for a plant, customers for a warehouse; a new From clears an unreachable To", () => {
    render(<SuperAddRowDialog table="distanceOverrides" network={base} onAdd={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByRole("dialog", { name: "Add distance override" })).toBeInTheDocument();
    expect(options("super-add-fromId")).toEqual(["", "P1", "W1"]);
    fireEvent.change(screen.getByTestId("super-add-fromId"), { target: { value: "P1" } });
    expect(options("super-add-toId")).toEqual(["", "W1"]);
    fireEvent.change(screen.getByTestId("super-add-toId"), { target: { value: "W1" } });
    fireEvent.change(screen.getByTestId("super-add-fromId"), { target: { value: "W1" } });
    expect(options("super-add-toId")).toEqual(["", "C1"]);
    expect(screen.getByTestId("super-add-toId")).toHaveValue("");
  });

  it("a duplicate pair is shown inline and cannot be added", () => {
    const onAdd = vi.fn();
    render(<SuperAddRowDialog table="plantProducts" network={base} onAdd={onAdd} onCancel={vi.fn()} />);
    expect(screen.getByRole("dialog", { name: "Add capability" })).toBeInTheDocument();
    fireEvent.change(screen.getByTestId("super-add-plantId"), { target: { value: "P1" } });
    fireEvent.change(screen.getByTestId("super-add-productId"), { target: { value: "K1" } });
    fireEvent.change(screen.getByTestId("super-add-capacity"), { target: { value: "0" } });
    fireEvent.change(screen.getByTestId("super-add-costPerUnit"), { target: { value: "0" } });
    expect(screen.getByTestId("super-add-form-error")).toHaveTextContent("Plant P1 already has a row for product K1.");
    expect(screen.getByTestId("super-add-confirm")).toBeDisabled();
    fireEvent.click(screen.getByTestId("super-add-confirm"));
    expect(onAdd).not.toHaveBeenCalled();
  });

  it("Cancel calls onCancel and never onAdd", () => {
    const onAdd = vi.fn(), onCancel = vi.fn();
    render(<SuperAddRowDialog table="products" network={base} onAdd={onAdd} onCancel={onCancel} />);
    expect(screen.getByRole("dialog", { name: "Add product" })).toBeInTheDocument();
    expect(screen.getByTestId("super-add-id")).toHaveValue("");
    fireEvent.click(screen.getByTestId("super-add-cancel"));
    expect(onCancel).toHaveBeenCalled();
    expect(onAdd).not.toHaveBeenCalled();
  });
});
