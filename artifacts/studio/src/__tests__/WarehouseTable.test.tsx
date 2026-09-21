import { describe, it, expect, vi } from "vitest";
import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { WarehouseTable } from "@/components/tables/WarehouseTable";
import type { WarehouseOverride } from "@/components/tables/WarehouseTable";

const warehouses = [
  { id: "CHI", city: "Chicago", state: "IL", lat: 41.8781, lng: -87.6298 },
  { id: "LA", city: "Los Angeles", state: "CA", lat: 34.0522, lng: -118.2437 },
];

// Simulates real usage (Studio.tsx re-renders with the updated overrides on
// every onChange, via setLocalConfig).
function StatefulWarehouseTable(props: { capacityMode: "none" | "uniform" | "per_wh"; onChangeSpy: (next: WarehouseOverride[]) => void }) {
  const [overrides, setOverrides] = useState<WarehouseOverride[]>([]);
  return (
    <WarehouseTable
      warehouses={warehouses}
      overrides={overrides}
      capacityMode={props.capacityMode}
      onChange={next => { setOverrides(next); props.onChangeSpy(next); }}
    />
  );
}

// chen-bands-units follow-up (QA defect) — same round trip as
// StatefulWarehouseTable, plus an explicit "Discard" action that mutates
// the SAME `overrides` state from OUTSIDE WarehouseTable's own onChange
// path — mirrors Workspace.tsx's real `handleDirtyNavDiscard`.
function StatefulWarehouseTableWithDiscard() {
  const [overrides, setOverrides] = useState<WarehouseOverride[]>([]);
  return (
    <div>
      <WarehouseTable warehouses={warehouses} overrides={overrides} capacityMode="per_wh" onChange={setOverrides} />
      <button type="button" onClick={() => setOverrides([])}>discard</button>
    </div>
  );
}

describe("WarehouseTable", () => {
  it("renders one row per warehouse with id and city/state", () => {
    render(<WarehouseTable warehouses={warehouses} overrides={[]} capacityMode="uniform" onChange={vi.fn()} />);
    expect(screen.getByText("CHI")).toBeInTheDocument();
    expect(screen.getByText("Chicago")).toBeInTheDocument();
    expect(screen.getByText("IL")).toBeInTheDocument();
    expect(screen.getByText("LA")).toBeInTheDocument();
  });

  it("renders City/State/Lat/Lng as separate columns, and Zip only when present", () => {
    const withZip = [{ id: "ALN", city: "Allentown", state: "PA", lat: 40.6028, lng: -75.4704, zip: "18101" }];
    const { rerender } = render(
      <WarehouseTable warehouses={withZip} overrides={[]} capacityMode="none" onChange={() => {}} />
    );
    expect(screen.getByText("Allentown")).toBeInTheDocument();
    expect(screen.getByText("PA")).toBeInTheDocument();
    expect(screen.getByText("40.6028")).toBeInTheDocument();
    expect(screen.getByText("18101")).toBeInTheDocument();

    const noZip = [{ id: "ATL", city: "Atlanta", state: "GA", lat: 33.7537, lng: -84.3895 }];
    rerender(<WarehouseTable warehouses={noZip} overrides={[]} capacityMode="none" onChange={() => {}} />);
    expect(screen.queryByText("Zip")).not.toBeInTheDocument();
  });

  it("does NOT show a Capacity column when capacityMode is not per_wh", () => {
    render(<WarehouseTable warehouses={warehouses} overrides={[]} capacityMode="uniform" onChange={vi.fn()} />);
    expect(screen.queryByText("Capacity")).not.toBeInTheDocument();
  });

  // C4.12 — Chen's Cosmetics persists capacityMode "none" (no capacity
  // concept), so its Warehouses table is status-only: no Capacity column.
  it("does NOT show a Capacity column when capacityMode is 'none' (Chen's mode)", () => {
    render(<WarehouseTable warehouses={warehouses} overrides={[]} capacityMode="none" onChange={vi.fn()} />);
    expect(screen.queryByText("Capacity")).not.toBeInTheDocument();
  });

  it("shows a Capacity column when capacityMode is per_wh", () => {
    render(<WarehouseTable warehouses={warehouses} overrides={[]} capacityMode="per_wh" onChange={vi.fn()} />);
    expect(screen.getByText("Capacity")).toBeInTheDocument();
  });

  it("applies DD-6's label mapping (Potential / Fixed-Open / Inactive) — this is the single mapping constant, not re-implemented per caller", () => {
    render(<WarehouseTable warehouses={warehouses} overrides={[]} capacityMode="uniform" onChange={vi.fn()} />);
    expect(screen.getAllByText("Potential").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Fixed-Open").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Inactive").length).toBeGreaterThan(0);
    expect(screen.queryByText("Active")).not.toBeInTheDocument();
    expect(screen.queryByText("Forced open")).not.toBeInTheDocument();
  });

  it("clicking Forced open calls onChange with an upserted override", async () => {
    const onChange = vi.fn();
    render(<WarehouseTable warehouses={warehouses} overrides={[]} capacityMode="uniform" onChange={onChange} />);
    await userEvent.click(screen.getByTestId("button-wh-CHI-forced_open"));
    expect(onChange).toHaveBeenCalledWith([{ id: "CHI", status: "forced_open", capacity: undefined }]);
  });

  it("edit persists: setting a per-warehouse capacity round-trips through overrides prop", async () => {
    const onChangeSpy = vi.fn();
    render(<StatefulWarehouseTable capacityMode="per_wh" onChangeSpy={onChangeSpy} />);
    await userEvent.type(screen.getByTestId("input-wh-capacity-CHI"), "50000");
    expect(screen.getByTestId("input-wh-capacity-CHI")).toHaveValue(50000);
    expect(onChangeSpy).toHaveBeenLastCalledWith([{ id: "CHI", status: "active", capacity: 50000 }]);
  });

  it("returning status to active with no capacity removes the override entirely", async () => {
    const onChange = vi.fn();
    const overrides: WarehouseOverride[] = [{ id: "CHI", status: "forced_open" }];
    render(<WarehouseTable warehouses={warehouses} overrides={overrides} capacityMode="uniform" onChange={onChange} />);
    await userEvent.click(screen.getByTestId("button-wh-CHI-active"));
    expect(onChange).toHaveBeenCalledWith([]);
  });

  // Chen's Cosmetics (chens-cosmetics-cn) — a China dataset with no state
  // data. `hasStateColumn` defaults true (unchanged for every other caller).
  it("omitting hasStateColumn (default true) keeps the State column", () => {
    render(<WarehouseTable warehouses={warehouses} overrides={[]} capacityMode="uniform" onChange={vi.fn()} />);
    expect(screen.getByText("State")).toBeInTheDocument();
    expect(screen.getByText("IL")).toBeInTheDocument();
  });

  it("hasStateColumn=false drops the State column header and cells", () => {
    render(<WarehouseTable warehouses={warehouses} overrides={[]} capacityMode="uniform" onChange={vi.fn()} hasStateColumn={false} />);
    expect(screen.queryByText("State")).not.toBeInTheDocument();
    expect(screen.queryByText("IL")).not.toBeInTheDocument();
    expect(screen.getByText("Chicago")).toBeInTheDocument();
  });

  // chen-bands-units follow-up (QA defect) — draft-shadowing fix. See
  // CustomerTable.test.tsx's identical describe block for the full
  // rationale; this mirrors it for the capacity field.
  describe("draft resync (QA defect fix)", () => {
    it("typing a multi-character value is not reset mid-keystroke (regression guard for the reset mechanism)", async () => {
      const onChangeSpy = vi.fn();
      render(<StatefulWarehouseTable capacityMode="per_wh" onChangeSpy={onChangeSpy} />);
      const input = screen.getByTestId("input-wh-capacity-CHI");
      await userEvent.type(input, "12345");
      // If the reset mechanism ever fired on the component's OWN commits,
      // this would have snapped back to an earlier partial value (or
      // cleared) somewhere mid-sequence instead of accumulating.
      expect(input).toHaveValue(12345);
      expect(onChangeSpy).toHaveBeenLastCalledWith([{ id: "CHI", status: "active", capacity: 12345 }]);
    });

    it("disabled=true renders the input disabled and blocks typing from changing its displayed value", async () => {
      const onChange = vi.fn();
      render(<WarehouseTable warehouses={warehouses} overrides={[]} capacityMode="per_wh" onChange={onChange} disabled />);
      const input = screen.getByTestId("input-wh-capacity-CHI");
      expect(input).toBeDisabled();
      await userEvent.type(input, "99999");
      expect(input).toHaveValue(null); // empty (no capacity override, no baseline) — unchanged
      expect(onChange).not.toHaveBeenCalled();
    });

    it("after an external override change (e.g. Discard), the input shows the reverted value, not the previously-typed one", async () => {
      render(<StatefulWarehouseTableWithDiscard />);
      const input = screen.getByTestId("input-wh-capacity-CHI");
      await userEvent.type(input, "7500");
      expect(input).toHaveValue(7500);
      // Discard reverts `overrides` from OUTSIDE this component's own
      // onChange path — exactly the shape of Workspace.tsx's real
      // `handleDirtyNavDiscard`.
      await userEvent.click(screen.getByText("discard"));
      expect(screen.getByTestId("input-wh-capacity-CHI")).toHaveValue(null);
    });
  });

  // T8 (Workspace fixups 2, item 3) — filtering (and the FilterMenu) moved
  // OUT of this component and up to WarehousesTab.tsx's own toolbar row
  // (mirrors CustomerTable/CustomersTab's already-existing split — see
  // WarehousesTab.test.tsx's "enableFilters (B6)" / "FilterMenu placement
  // (T8, item 3)" describe blocks for that coverage now). WarehouseTable
  // itself is purely a display component: it renders whatever `warehouses`
  // rows the caller passes, filtered or not.
});
