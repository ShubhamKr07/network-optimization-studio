import { describe, it, expect, vi } from "vitest";
import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CustomerTable } from "@/components/tables/CustomerTable";
import type { CustomerOverride } from "@/components/tables/CustomerTable";

// Simulates real usage (Studio.tsx re-renders with the updated overrides on
// every onChange, via setLocalConfig) — a plain mutated array with a single
// manual rerender doesn't exercise the controlled-input round trip properly.
function StatefulCustomerTable(props: { customers: Parameters<typeof CustomerTable>[0]["customers"]; onChangeSpy: (next: CustomerOverride[]) => void }) {
  const [overrides, setOverrides] = useState<CustomerOverride[]>([]);
  return (
    <CustomerTable
      customers={props.customers}
      overrides={overrides}
      onChange={next => { setOverrides(next); props.onChangeSpy(next); }}
    />
  );
}

const customers = Array.from({ length: 200 }, (_, i) => ({
  id: `C${i + 1}`,
  city: `City${i + 1}`,
  state: "XX",
  lat: 40 + i * 0.01,
  lng: -75 - i * 0.01,
  demand: 1000 + i,
}));

describe("CustomerTable", () => {
  it("renders one row per customer with base demand pre-filled", () => {
    render(<CustomerTable customers={customers.slice(0, 2)} overrides={[]} onChange={vi.fn()} />);
    expect(screen.getByTestId("input-customer-demand-C1")).toHaveValue(1000);
    expect(screen.getByTestId("input-customer-demand-C2")).toHaveValue(1001);
  });

  it("renders all 200 rows without crashing", () => {
    render(<CustomerTable customers={customers} overrides={[]} onChange={vi.fn()} />);
    expect(screen.getByText("C1")).toBeInTheDocument();
    expect(screen.getByText("C200")).toBeInTheDocument();
  });

  it("renders City/State/Lat/Lng as separate columns, and Zip only when present", () => {
    const withZip = [{ id: "ALN", city: "Allentown", state: "PA", lat: 40.6028, lng: -75.4704, zip: "18101", demand: 500 }];
    const { rerender } = render(<CustomerTable customers={withZip} overrides={[]} onChange={() => {}} />);
    expect(screen.getByText("Allentown")).toBeInTheDocument();
    expect(screen.getByText("PA")).toBeInTheDocument();
    expect(screen.getByText("40.6028")).toBeInTheDocument();
    expect(screen.getByText("18101")).toBeInTheDocument();

    const noZip = [{ id: "ATL", city: "Atlanta", state: "GA", lat: 33.7537, lng: -84.3895, demand: 500 }];
    rerender(<CustomerTable customers={noZip} overrides={[]} onChange={() => {}} />);
    expect(screen.queryByText("Zip")).not.toBeInTheDocument();
  });

  it("edit persists: changing demand round-trips through overrides prop", async () => {
    const onChangeSpy = vi.fn();
    render(<StatefulCustomerTable customers={customers.slice(0, 2)} onChangeSpy={onChangeSpy} />);
    const input = screen.getByTestId("input-customer-demand-C1");
    await userEvent.clear(input);
    await userEvent.type(input, "5000");
    expect(screen.getByTestId("input-customer-demand-C1")).toHaveValue(5000);
    expect(onChangeSpy).toHaveBeenLastCalledWith([{ id: "C1", status: "active", demand: 5000 }]);
  });

  it("blocks a negative demand with an inline error and does not call onChange", async () => {
    const onChangeSpy = vi.fn();
    render(<StatefulCustomerTable customers={customers.slice(0, 2)} onChangeSpy={onChangeSpy} />);
    const input = screen.getByTestId("input-customer-demand-C1");
    await userEvent.clear(input);
    onChangeSpy.mockClear();
    await userEvent.type(input, "-5");
    expect(screen.getByTestId("error-customer-demand-C1")).toHaveTextContent(/must be/i);
    expect(onChangeSpy).not.toHaveBeenCalled();
  });

  it("clicking Excluded calls onChange with an upserted override", async () => {
    const onChange = vi.fn();
    render(<CustomerTable customers={customers.slice(0, 2)} overrides={[]} onChange={onChange} />);
    await userEvent.click(screen.getByTestId("button-customer-C1-excluded"));
    expect(onChange).toHaveBeenCalledWith([{ id: "C1", status: "excluded", demand: undefined }]);
  });
});
