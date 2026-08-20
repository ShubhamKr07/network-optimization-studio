import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { CustomersTab } from "@/components/workspace/tabs/CustomersTab";

const customers = [
  { id: "C1", city: "New York", state: "NY", lat: 40.71, lng: -74.0, demand: 100 },
  { id: "C2", city: "Boston", state: "MA", lat: 42.36, lng: -71.06, demand: 50 },
];

describe("CustomersTab", () => {
  it("renders the real CustomerTable with the dataset's customers (not a placeholder)", () => {
    render(<CustomersTab customers={customers} overrides={[]} onChange={vi.fn()} />);
    expect(screen.getByText("C1")).toBeInTheDocument();
    expect(screen.getByText("New York, NY")).toBeInTheDocument();
    expect(screen.getByText("C2")).toBeInTheDocument();
    expect(screen.queryByTestId("tab-content-placeholder")).not.toBeInTheDocument();
  });

  it("calls onChange with an upserted override when demand is edited", () => {
    const onChange = vi.fn();
    render(<CustomersTab customers={customers} overrides={[]} onChange={onChange} />);
    fireEvent.change(screen.getByTestId("input-customer-demand-C1"), { target: { value: "250" } });
    expect(onChange).toHaveBeenCalledWith([{ id: "C1", status: "active", demand: 250 }]);
  });

  it("calls onChange when a status button is clicked", () => {
    const onChange = vi.fn();
    render(<CustomersTab customers={customers} overrides={[]} onChange={onChange} />);
    fireEvent.click(screen.getByTestId("button-customer-C1-excluded"));
    expect(onChange).toHaveBeenCalledWith([{ id: "C1", status: "excluded", demand: undefined }]);
  });

  it("shows an empty state when the dataset has no customers", () => {
    render(<CustomersTab customers={[]} overrides={[]} onChange={vi.fn()} />);
    expect(screen.getByTestId("customers-tab-empty")).toBeInTheDocument();
  });
});
