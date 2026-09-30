import { useState } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// Task 11 — DeliveryCostsTab is modelled directly on DistancesTab.tsx's
// merged base+override architecture (see that component's own tests,
// DistancesTab.test.tsx, for the interaction patterns these tests mirror),
// but its data source is `useGetReferenceCosts` (Task 7's generated hook),
// not a real fetch — so, per the brief, these tests mock the HOOK directly
// rather than DistancesTab.test.tsx's global.fetch + real QueryClientProvider
// approach. That also means no UnitProvider/ExportProvider wrapper is
// needed: DeliveryCostsTab never calls useDisplayUnit/useExport (a cost is
// billable miles, not a distance — it never routes through useDistanceDraft
// or any unit conversion, the whole point of this chapter's cost/distance
// separation).

const mockUseGetReferenceCosts = vi.fn();
vi.mock("@workspace/api-client-react", () => ({
  useGetReferenceCosts: (...args: unknown[]) => mockUseGetReferenceCosts(...args),
  getGetReferenceCostsQueryKey: vi.fn((id: string) => ["reference-costs", id]),
}));

import { DeliveryCostsTab } from "@/components/workspace/tabs/DeliveryCostsTab";

interface Pair {
  fromId: string;
  fromCode: string;
  toId: string;
  toCode: string;
  cost: number;
}

function mockReferenceCosts(pairs: Pair[]) {
  mockUseGetReferenceCosts.mockReturnValue({ data: { pairs, distanceUnit: "mi" }, isLoading: false, isError: false });
}

// A 33-warehouse-id-space x arbitrary-customer-count fixture, matching the
// real dataset's warehouse cardinality (solvers/delivery-teaching-us has 33
// warehouses x 313 customers = 10,329 lanes) so the pagination math below
// (Math.ceil(n/50)) matches real-dataset arithmetic, not an arbitrary size.
function buildPairs(n: number): Pair[] {
  return Array.from({ length: n }, (_, i) => {
    const fromId = `W${(i % 33) + 1}`;
    const toId = `C${i + 1}`;
    return { fromId, fromCode: fromId, toId, toCode: toId, cost: 10 + i };
  });
}

beforeEach(() => {
  mockUseGetReferenceCosts.mockReset();
  mockUseGetReferenceCosts.mockReturnValue({ data: undefined, isLoading: false, isError: false });
});

describe("DeliveryCostsTab", () => {
  it("renders base rows from the reference-costs query", () => {
    mockReferenceCosts([
      { fromId: "W1", fromCode: "W1", toId: "C1", toCode: "C1", cost: 12.5 },
      { fromId: "W1", fromCode: "W1", toId: "C2", toCode: "C2", cost: 20 },
      { fromId: "W2", fromCode: "W2", toId: "C1", toCode: "C1", cost: 8 },
    ]);
    render(<DeliveryCostsTab laneCostOverrides={[]} onChange={vi.fn()} modelId="delivery-teaching-us" />);

    expect(screen.getByTestId("row-deliverycost-W1-C1")).toBeInTheDocument();
    expect(screen.getByTestId("row-deliverycost-W1-C2")).toBeInTheDocument();
    expect(screen.getByTestId("row-deliverycost-W2-C1")).toBeInTheDocument();
    expect(screen.getByTestId("row-deliverycost-W1-C1")).toHaveTextContent("12.5");
  });

  it("shows an override in place of its base value and marks it overridden", () => {
    // This IS the "filter to a lane, edit its cost" primary flow the brief
    // describes — a stateful wrapper (mirrors DistancesTab.test.tsx's own
    // Wrapper-component tests) so the edit's effect on both the Cost cell
    // and the Base cell is actually observable, not just the onChange args.
    mockReferenceCosts([{ fromId: "W1", fromCode: "W1", toId: "C1", toCode: "C1", cost: 12.5 }]);
    const onChange = vi.fn();
    const Wrapper = () => {
      const [rows, setRows] = useState<{ fromId: string; toId: string; cost: number }[]>([]);
      return (
        <DeliveryCostsTab
          laneCostOverrides={rows}
          onChange={next => {
            onChange(next);
            setRows(next);
          }}
          modelId="delivery-teaching-us"
        />
      );
    };
    render(<Wrapper />);

    expect(screen.getByTestId("input-deliverycost-W1-C1")).toHaveValue("");
    expect(screen.queryByTestId("badge-deliverycost-overridden-W1-C1")).not.toBeInTheDocument();

    fireEvent.change(screen.getByTestId("input-deliverycost-W1-C1"), { target: { value: "99" } });
    fireEvent.blur(screen.getByTestId("input-deliverycost-W1-C1"));

    expect(onChange).toHaveBeenCalledWith([{ fromId: "W1", toId: "C1", cost: 99 }]);
    // The override value now shows IN PLACE of the blank it replaced...
    expect(screen.getByTestId("input-deliverycost-W1-C1")).toHaveValue("99");
    // ...marked overridden...
    expect(screen.getByTestId("badge-deliverycost-overridden-W1-C1")).toBeInTheDocument();
    // ...while the Base column keeps showing the untouched reference value.
    expect(screen.getByTestId("row-deliverycost-W1-C1")).toHaveTextContent("12.5");
  });

  it("paginates at 50 rows", () => {
    mockReferenceCosts(buildPairs(120));
    render(<DeliveryCostsTab laneCostOverrides={[]} onChange={vi.fn()} modelId="delivery-teaching-us" />);

    expect(screen.getByTestId("delivery-costs-page-indicator")).toHaveTextContent("Page 1 of 3");
    expect(document.querySelectorAll('[data-testid^="row-deliverycost-"]').length).toBe(50);

    fireEvent.click(screen.getByTestId("button-delivery-costs-next"));
    expect(screen.getByTestId("delivery-costs-page-indicator")).toHaveTextContent("Page 2 of 3");
    expect(document.querySelectorAll('[data-testid^="row-deliverycost-"]').length).toBe(50);
  });

  it("renders the first page of a 10,329-pair table without materialising every row", () => {
    // spec 8.4: "pagination works at 10,329 rows" — a 120-row mock (above)
    // cannot prove that; this uses the real dataset's exact cardinality
    // (33 warehouses x 313 customers).
    mockReferenceCosts(buildPairs(10329));
    render(<DeliveryCostsTab laneCostOverrides={[]} onChange={vi.fn()} modelId="delivery-teaching-us" />);

    expect(document.querySelectorAll('[data-testid^="row-deliverycost-"]').length).toBe(50);
    expect(screen.getByTestId("delivery-costs-page-indicator")).toHaveTextContent(`Page 1 of ${Math.ceil(10329 / 50)}`);
  });

  it("filters by from-id substring", () => {
    const overrides = [
      { fromId: "W1", toId: "C1", cost: 10 },
      { fromId: "W2", toId: "C1", cost: 20 },
    ];
    render(<DeliveryCostsTab laneCostOverrides={overrides} onChange={vi.fn()} />);

    fireEvent.change(screen.getByTestId("input-filter-from"), { target: { value: "W2" } });

    expect(screen.queryByTestId("row-deliverycost-W1-C1")).not.toBeInTheDocument();
    expect(screen.getByTestId("row-deliverycost-W2-C1")).toBeInTheDocument();
  });

  it("filters by to-id substring", () => {
    const overrides = [
      { fromId: "W1", toId: "C1", cost: 10 },
      { fromId: "W1", toId: "C2", cost: 20 },
    ];
    render(<DeliveryCostsTab laneCostOverrides={overrides} onChange={vi.fn()} />);

    fireEvent.change(screen.getByTestId("input-filter-to"), { target: { value: "C2" } });

    expect(screen.queryByTestId("row-deliverycost-W1-C1")).not.toBeInTheDocument();
    expect(screen.getByTestId("row-deliverycost-W1-C2")).toBeInTheDocument();
  });

  it("adds an override for a typed pair", async () => {
    const onChange = vi.fn();
    render(<DeliveryCostsTab laneCostOverrides={[]} onChange={onChange} />);

    await userEvent.click(screen.getByTestId("button-add-deliverycost-row"));
    await userEvent.type(screen.getByTestId("input-new-deliverycost-from"), "W5");
    await userEvent.type(screen.getByTestId("input-new-deliverycost-to"), "C9");
    await userEvent.type(screen.getByTestId("input-new-deliverycost-value"), "42");
    await userEvent.click(screen.getByTestId("button-add-deliverycost-confirm"));

    expect(onChange).toHaveBeenCalledWith([{ fromId: "W5", toId: "C9", cost: 42 }]);
  });

  it("rejects a duplicate (fromId,toId) at add time", async () => {
    const onChange = vi.fn();
    const overrides = [{ fromId: "W5", toId: "C9", cost: 42 }];
    render(<DeliveryCostsTab laneCostOverrides={overrides} onChange={onChange} />);

    await userEvent.click(screen.getByTestId("button-add-deliverycost-row"));
    await userEvent.type(screen.getByTestId("input-new-deliverycost-from"), "W5");
    await userEvent.type(screen.getByTestId("input-new-deliverycost-to"), "C9");
    await userEvent.type(screen.getByTestId("input-new-deliverycost-value"), "1");
    await userEvent.click(screen.getByTestId("button-add-deliverycost-confirm"));

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByTestId("text-add-deliverycost-error")).toBeInTheDocument();
  });

  it("accepts a zero cost", async () => {
    // The dataset ships 33 zero-cost self-lanes (a warehouse co-located
    // with a customer) — zero must be accepted, not rejected as falsy/blank.
    const onChange = vi.fn();
    render(<DeliveryCostsTab laneCostOverrides={[]} onChange={onChange} />);

    await userEvent.click(screen.getByTestId("button-add-deliverycost-row"));
    await userEvent.type(screen.getByTestId("input-new-deliverycost-from"), "W1");
    await userEvent.type(screen.getByTestId("input-new-deliverycost-to"), "C1");
    await userEvent.type(screen.getByTestId("input-new-deliverycost-value"), "0");
    await userEvent.click(screen.getByTestId("button-add-deliverycost-confirm"));

    expect(onChange).toHaveBeenCalledWith([{ fromId: "W1", toId: "C1", cost: 0 }]);
    expect(screen.queryByTestId("text-add-deliverycost-error")).not.toBeInTheDocument();
  });

  it("rejects a negative cost", async () => {
    const onChange = vi.fn();
    render(<DeliveryCostsTab laneCostOverrides={[]} onChange={onChange} />);

    await userEvent.click(screen.getByTestId("button-add-deliverycost-row"));
    await userEvent.type(screen.getByTestId("input-new-deliverycost-from"), "W1");
    await userEvent.type(screen.getByTestId("input-new-deliverycost-to"), "C1");
    await userEvent.type(screen.getByTestId("input-new-deliverycost-value"), "-5");
    await userEvent.click(screen.getByTestId("button-add-deliverycost-confirm"));

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByTestId("text-add-deliverycost-error")).toBeInTheDocument();
  });

  // I-1 (whole-branch review) — the server precheck 422 never names the
  // offending id to the student, and this model has no allowlisted precheck
  // query to catch it later; handleAddRow must reject an unknown id inline,
  // naming it, using the already-fetched base matrix.
  it("rejects an add-row with an unknown warehouse id, naming it inline", async () => {
    mockReferenceCosts([{ fromId: "W1", fromCode: "W1", toId: "C1", toCode: "C1", cost: 12.5 }]);
    const onChange = vi.fn();
    render(<DeliveryCostsTab laneCostOverrides={[]} onChange={onChange} modelId="delivery-teaching-us" />);

    await userEvent.click(screen.getByTestId("button-add-deliverycost-row"));
    await userEvent.type(screen.getByTestId("input-new-deliverycost-from"), "W999");
    await userEvent.type(screen.getByTestId("input-new-deliverycost-to"), "C1");
    await userEvent.type(screen.getByTestId("input-new-deliverycost-value"), "5");
    await userEvent.click(screen.getByTestId("button-add-deliverycost-confirm"));

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByTestId("text-add-deliverycost-error")).toHaveTextContent("W999");
  });

  it("rejects an add-row with an unknown customer id, naming it inline", async () => {
    mockReferenceCosts([{ fromId: "W1", fromCode: "W1", toId: "C1", toCode: "C1", cost: 12.5 }]);
    const onChange = vi.fn();
    render(<DeliveryCostsTab laneCostOverrides={[]} onChange={onChange} modelId="delivery-teaching-us" />);

    await userEvent.click(screen.getByTestId("button-add-deliverycost-row"));
    await userEvent.type(screen.getByTestId("input-new-deliverycost-from"), "W1");
    await userEvent.type(screen.getByTestId("input-new-deliverycost-to"), "C999");
    await userEvent.type(screen.getByTestId("input-new-deliverycost-value"), "5");
    await userEvent.click(screen.getByTestId("button-add-deliverycost-confirm"));

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByTestId("text-add-deliverycost-error")).toHaveTextContent("C999");
  });

  it("still adds a valid lane once the base matrix has loaded", async () => {
    mockReferenceCosts([{ fromId: "W1", fromCode: "W1", toId: "C1", toCode: "C1", cost: 12.5 }]);
    const onChange = vi.fn();
    render(<DeliveryCostsTab laneCostOverrides={[]} onChange={onChange} modelId="delivery-teaching-us" />);

    await userEvent.click(screen.getByTestId("button-add-deliverycost-row"));
    await userEvent.type(screen.getByTestId("input-new-deliverycost-from"), "W1");
    await userEvent.type(screen.getByTestId("input-new-deliverycost-to"), "C1");
    await userEvent.type(screen.getByTestId("input-new-deliverycost-value"), "5");
    await userEvent.click(screen.getByTestId("button-add-deliverycost-confirm"));

    expect(onChange).toHaveBeenCalledWith([{ fromId: "W1", toId: "C1", cost: 5 }]);
  });

  // I-2 (whole-branch review) — the 546 KB reference-costs response must
  // show a real loading/error state instead of the false "No cost data yet"
  // empty message. The existing 11 tests above all mock isLoading:false, so
  // nothing covered these branches before this fix.
  it("shows a loading state while the reference-costs query is in flight", () => {
    mockUseGetReferenceCosts.mockReturnValue({ data: undefined, isLoading: true, isError: false });
    render(<DeliveryCostsTab laneCostOverrides={[]} onChange={vi.fn()} modelId="delivery-teaching-us" />);

    expect(screen.getByTestId("delivery-costs-tab-loading")).toBeInTheDocument();
    expect(screen.queryByTestId("delivery-costs-tab-empty")).not.toBeInTheDocument();
  });

  it("shows an error state when the reference-costs query fails", () => {
    mockUseGetReferenceCosts.mockReturnValue({ data: undefined, isLoading: false, isError: true });
    render(<DeliveryCostsTab laneCostOverrides={[]} onChange={vi.fn()} modelId="delivery-teaching-us" />);

    expect(screen.getByTestId("delivery-costs-tab-error")).toBeInTheDocument();
    expect(screen.queryByTestId("delivery-costs-tab-empty")).not.toBeInTheDocument();
  });

  it("removes an override and falls back to the base value", () => {
    mockReferenceCosts([{ fromId: "W1", fromCode: "W1", toId: "C1", toCode: "C1", cost: 12.5 }]);
    const onChange = vi.fn();
    const Wrapper = () => {
      const [rows, setRows] = useState([{ fromId: "W1", toId: "C1", cost: 99 }]);
      return (
        <DeliveryCostsTab
          laneCostOverrides={rows}
          onChange={next => {
            onChange(next);
            setRows(next);
          }}
          modelId="delivery-teaching-us"
        />
      );
    };
    render(<Wrapper />);

    expect(screen.getByTestId("input-deliverycost-W1-C1")).toHaveValue("99");

    fireEvent.click(screen.getByTestId("button-remove-deliverycost-W1-C1"));

    expect(onChange).toHaveBeenCalledWith([]);
    expect(screen.getByTestId("input-deliverycost-W1-C1")).toHaveValue("");
    expect(screen.queryByTestId("badge-deliverycost-overridden-W1-C1")).not.toBeInTheDocument();
    // Row stays visible (it's a real base pair) showing the base value.
    expect(screen.getByTestId("row-deliverycost-W1-C1")).toHaveTextContent("12.5");
  });
});
