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

// chen-bands-units follow-up (QA defect) — same round trip as
// StatefulCustomerTable, plus an explicit "Discard" action that mutates the
// SAME `overrides` state from OUTSIDE CustomerTable's own onChange path —
// i.e. a genuine EXTERNAL mutation, mirroring Workspace.tsx's real
// `handleDirtyNavDiscard` (`setLocalInputs(savedInputsRef.current)`).
function StatefulCustomerTableWithDiscard(props: { customers: Parameters<typeof CustomerTable>[0]["customers"] }) {
  const [overrides, setOverrides] = useState<CustomerOverride[]>([]);
  return (
    <div>
      <CustomerTable customers={props.customers} overrides={overrides} onChange={setOverrides} />
      <button type="button" onClick={() => setOverrides([])}>discard</button>
    </div>
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

  // T5 (Bundle 2, Step 2b) — demandEditable:false (p-median-brazil's
  // textbook-fixed region demand) makes every row's demand field read-only
  // in the grid, mirroring EditCustomerDialog's own Step 1b gate on the
  // Input Map side — same locked decision, second surface.
  describe("demandEditable (T5, Bundle 2, Step 2b)", () => {
    it("omitting demandEditable defaults to editable — today's exact behavior, unchanged", () => {
      render(<CustomerTable customers={customers.slice(0, 1)} overrides={[]} onChange={vi.fn()} />);
      expect(screen.getByTestId("input-customer-demand-C1")).toBeEnabled();
    });

    it("demandEditable=false disables every row's demand field; status stays editable", async () => {
      const onChange = vi.fn();
      render(<CustomerTable customers={customers.slice(0, 2)} overrides={[]} onChange={onChange} demandEditable={false} />);
      expect(screen.getByTestId("input-customer-demand-C1")).toBeDisabled();
      expect(screen.getByTestId("input-customer-demand-C2")).toBeDisabled();

      await userEvent.click(screen.getByTestId("button-customer-C1-excluded"));
      expect(onChange).toHaveBeenCalledWith([{ id: "C1", status: "excluded", demand: undefined }]);
    });
  });

  // Bundle 3, T9 — mono-numbers pass: numeric table cells and numeric
  // inputs render in the monospace font; prose/labels (city/state) don't.
  it("renders numeric cells and the demand input with font-mono (Bundle 3, T9)", () => {
    const withZip = [{ id: "ALN", city: "Allentown", state: "PA", lat: 40.6028, lng: -75.4704, zip: "18101", demand: 500 }];
    render(<CustomerTable customers={withZip} overrides={[]} onChange={vi.fn()} />);
    expect(screen.getByText("40.6028")).toHaveClass("font-mono");
    expect(screen.getByText("18101")).toHaveClass("font-mono");
    expect(screen.getByTestId("input-customer-demand-ALN")).toHaveClass("font-mono");
    expect(screen.getByText("Allentown")).not.toHaveClass("font-mono");
  });

  // Chen's Cosmetics (chens-cosmetics-cn) — a China dataset with no state
  // data. `hasStateColumn` defaults true (unchanged for every other caller).
  it("omitting hasStateColumn (default true) keeps the State column", () => {
    render(<CustomerTable customers={customers.slice(0, 2)} overrides={[]} onChange={vi.fn()} />);
    expect(screen.getByText("State")).toBeInTheDocument();
    expect(screen.getAllByText("XX").length).toBe(2);
  });

  it("hasStateColumn=false drops the State column header and cells", () => {
    render(<CustomerTable customers={customers.slice(0, 2)} overrides={[]} onChange={vi.fn()} hasStateColumn={false} />);
    expect(screen.queryByText("State")).not.toBeInTheDocument();
    expect(screen.queryByText("XX")).not.toBeInTheDocument();
    expect(screen.getByText("City1")).toBeInTheDocument();
  });

  // chen-bands-units follow-up (QA defect) — the two draft-shadowing bugs
  // QA found live: (1) typing while browsing an older result-history entry
  // visually "stuck" even though the write was a no-op at the data layer;
  // (2) Discard reverted `localInputs` but the table's own local `drafts`
  // state kept showing the discarded value. Both traced to `drafts` never
  // being resynced against the `overrides`/`customers` props once set.
  describe("draft resync (QA defect fix)", () => {
    it("typing a multi-character value is not reset mid-keystroke (regression guard for the reset mechanism)", async () => {
      const onChangeSpy = vi.fn();
      render(<StatefulCustomerTable customers={customers.slice(0, 2)} onChangeSpy={onChangeSpy} />);
      const input = screen.getByTestId("input-customer-demand-C1");
      await userEvent.clear(input);
      await userEvent.type(input, "84200");
      // If the reset mechanism ever fired on the component's OWN commits
      // (rather than only on an external mutation), this would have snapped
      // back to a stale value somewhere mid-sequence instead of
      // accumulating to the full typed number.
      expect(input).toHaveValue(84200);
      expect(onChangeSpy).toHaveBeenLastCalledWith([{ id: "C1", status: "active", demand: 84200 }]);
    });

    it("disabled=true renders the input disabled and blocks typing from changing its displayed value", async () => {
      const onChange = vi.fn();
      render(<CustomerTable customers={customers.slice(0, 1)} overrides={[]} onChange={onChange} disabled />);
      const input = screen.getByTestId("input-customer-demand-C1");
      expect(input).toBeDisabled();
      await userEvent.type(input, "12345");
      expect(input).toHaveValue(1000); // unchanged base demand
      expect(onChange).not.toHaveBeenCalled();
    });

    it("after an external override change (e.g. Discard), the input shows the reverted value, not the previously-typed one", async () => {
      render(<StatefulCustomerTableWithDiscard customers={customers.slice(0, 1)} />);
      const input = screen.getByTestId("input-customer-demand-C1");
      await userEvent.clear(input);
      await userEvent.type(input, "9999");
      expect(input).toHaveValue(9999);
      // Discard reverts `overrides` from OUTSIDE this component's own
      // onChange path — exactly the shape of Workspace.tsx's real
      // `handleDirtyNavDiscard` (setLocalInputs(savedInputsRef.current)).
      await userEvent.click(screen.getByText("discard"));
      expect(screen.getByTestId("input-customer-demand-C1")).toHaveValue(1000); // baseline demand
    });

    it("an in-progress invalid draft (never committed) is not clobbered by the resync check", async () => {
      const onChange = vi.fn();
      render(<CustomerTable customers={customers.slice(0, 1)} overrides={[]} onChange={onChange} />);
      const input = screen.getByTestId("input-customer-demand-C1");
      await userEvent.clear(input);
      // `clear()` itself commits demand:null (raw === "" is a real commit,
      // not "invalid") — same established fact as the pre-existing "blocks
      // a negative demand" test above; reset the spy before the part this
      // test actually cares about.
      onChange.mockClear();
      await userEvent.type(input, "-5");
      // Never committed (invalid) — the resync check must not have anything
      // recorded to compare against, so it must leave this draft alone
      // (still showing the error, not silently reverted to the baseline).
      expect(screen.getByTestId("error-customer-demand-C1")).toBeInTheDocument();
      expect(onChange).not.toHaveBeenCalled();
    });
  });
});
