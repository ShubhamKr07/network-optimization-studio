import { useState, type ComponentProps } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render as rtlRender, screen, fireEvent, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AllProviders } from "@/__tests__/helpers/renderWithExportProvider";

// SCU-2.P4.7 — the tab now renders Upload ▾ / Download ▾ (useExport), which
// needs the ExportProvider; AllProviders supplies it (and UnitProvider).
function render(ui: Parameters<typeof rtlRender>[0]) {
  return rtlRender(ui, { wrapper: AllProviders });
}

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
import { filterText } from "@/__tests__/helpers/inputTable";

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
    expect(screen.getByTestId("row-deliverycost-W1-C1")).toHaveTextContent("12.50");
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
    expect(screen.getByTestId("input-deliverycost-W1-C1")).toHaveValue("99.00");
    // ...marked overridden...
    expect(screen.getByTestId("badge-deliverycost-overridden-W1-C1")).toBeInTheDocument();
    // ...while the Base column keeps showing the untouched reference value.
    expect(screen.getByTestId("row-deliverycost-W1-C1")).toHaveTextContent("12.50");
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

  // SCU-2.P4.7 (B2.2) — From/To are FilterMenu text controls, shown above
  // 10 rows: both filter fixtures carry 9 extra W9 rows.
  const padding = Array.from({ length: 9 }, (_, i) => ({ fromId: "W9", toId: `C9${i}`, cost: 30 + i }));

  it("filters by from-id substring", () => {
    const overrides = [
      { fromId: "W1", toId: "C1", cost: 10 },
      { fromId: "W2", toId: "C1", cost: 20 },
      ...padding,
    ];
    render(<DeliveryCostsTab laneCostOverrides={overrides} onChange={vi.fn()} />);

    filterText("from", "W2");

    expect(screen.queryByTestId("row-deliverycost-W1-C1")).not.toBeInTheDocument();
    expect(screen.getByTestId("row-deliverycost-W2-C1")).toBeInTheDocument();
  });

  it("filters by to-id substring", () => {
    const overrides = [
      { fromId: "W1", toId: "C1", cost: 10 },
      { fromId: "W1", toId: "C2", cost: 20 },
      ...padding,
    ];
    render(<DeliveryCostsTab laneCostOverrides={overrides} onChange={vi.fn()} />);

    filterText("to", "C2");

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

    expect(screen.getByTestId("input-deliverycost-W1-C1")).toHaveValue("99.00");

    fireEvent.click(screen.getByTestId("button-remove-deliverycost-W1-C1"));

    expect(onChange).toHaveBeenCalledWith([]);
    expect(screen.getByTestId("input-deliverycost-W1-C1")).toHaveValue("");
    expect(screen.queryByTestId("badge-deliverycost-overridden-W1-C1")).not.toBeInTheDocument();
    // Row stays visible (it's a real base pair) showing the base value.
    expect(screen.getByTestId("row-deliverycost-W1-C1")).toHaveTextContent("12.50");
  });
});

describe("DeliveryCostsTab — names and two decimals (WQF-C4/C6)", () => {
  const LOC = { W33: { city: "Springfield", state: "IL" }, C33: { city: "Arlington", state: "TX" } };

  it("shows From/To as `ID · City, ST` and still filters on the ID", () => {
    mockReferenceCosts(buildPairs(40));
    render(<DeliveryCostsTab laneCostOverrides={[]} onChange={vi.fn()} modelId="delivery-teaching-us" locationById={LOC} />);
    filterText("from", "W33");
    const row = screen.getByTestId("row-deliverycost-W33-C33");
    const cells = within(row).getAllByRole("cell");
    expect(cells[0]).toHaveTextContent(/^W33 · Springfield, IL$/);
    expect(cells[1]).toHaveTextContent(/^C33 · Arlington, TX$/);
    expect(screen.getAllByTestId(/^row-deliverycost-/)).toHaveLength(1);
  });

  it("falls back to the bare ID when a place is unknown", () => {
    mockReferenceCosts([{ fromId: "W1", fromCode: "W1", toId: "C1", toCode: "C1", cost: 5 }]);
    render(<DeliveryCostsTab laneCostOverrides={[]} onChange={vi.fn()} modelId="delivery-teaching-us" locationById={{}} />);
    expect(within(screen.getByTestId("row-deliverycost-W1-C1")).getAllByRole("cell")[0]).toHaveTextContent(/^W1$/);
  });

  it("displays Base and Cost rounded to 2 dp", () => {
    mockReferenceCosts([
      { fromId: "W1", fromCode: "W1", toId: "C1", toCode: "C1", cost: 1047.7157 },
      { fromId: "W1", fromCode: "W1", toId: "C2", toCode: "C2", cost: 1.005 },
    ]);
    render(<DeliveryCostsTab laneCostOverrides={[{ fromId: "W1", toId: "C2", cost: 3.14159 }]} onChange={vi.fn()} modelId="delivery-teaching-us" />);
    expect(within(screen.getByTestId("row-deliverycost-W1-C1")).getAllByRole("cell")[2]).toHaveTextContent(/^1047\.72$/);
    expect(within(screen.getByTestId("row-deliverycost-W1-C2")).getAllByRole("cell")[2]).toHaveTextContent(/^1\.01$/);
    expect(screen.getByTestId("input-deliverycost-W1-C2")).toHaveValue("3.14");
  });

  it("stores a hand-typed cost as typed, not rounded", () => {
    mockReferenceCosts([{ fromId: "W1", fromCode: "W1", toId: "C1", toCode: "C1", cost: 12.5 }]);
    const onChange = vi.fn();
    render(<DeliveryCostsTab laneCostOverrides={[]} onChange={onChange} modelId="delivery-teaching-us" />);
    fireEvent.change(screen.getByTestId("input-deliverycost-W1-C1"), { target: { value: "3.14159" } });
    fireEvent.blur(screen.getByTestId("input-deliverycost-W1-C1"));
    expect(onChange).toHaveBeenCalledWith([{ fromId: "W1", toId: "C1", cost: 3.14159 }]);
  });
});

describe("DeliveryCostsTab — Base multiplier (WQF-C5)", () => {
  function setup(pairs: Pair[], props: Partial<ComponentProps<typeof DeliveryCostsTab>> = {}) {
    mockReferenceCosts(pairs);
    const onApplyCosts = vi.fn();
    render(<DeliveryCostsTab laneCostOverrides={[]} onChange={vi.fn()} modelId="delivery-teaching-us" onApplyCosts={onApplyCosts} {...props} />);
    return onApplyCosts;
  }
  const apply = () => screen.getByTestId("button-deliverycost-apply-multiplier");
  const typeMultiplier = (v: string) => fireEvent.change(screen.getByTestId("input-deliverycost-multiplier"), { target: { value: v } });

  it.each(["", "0", "-2", "abc", "Infinity"])("disables Apply for %j", v => {
    setup(buildPairs(3));
    typeMultiplier(v);
    expect(apply()).toBeDisabled();
  });

  // Whole-branch review M4: Apply skips rows with no Base, so its count must too.
  it("counts only rows that have a Base in the Apply title", () => {
    setup(buildPairs(2), { laneCostOverrides: [{ fromId: "WX", toId: "CY", cost: 5 }] });
    typeMultiplier("2");
    expect(apply()).toHaveAttribute("title", "Set Cost = Base × 2 for 2 rows");
  });

  it("applies to all 10,329 rows when unfiltered, not just page 1", () => {
    const onApplyCosts = setup(buildPairs(10329));
    typeMultiplier("1.5");
    fireEvent.click(apply());
    const next = onApplyCosts.mock.calls[0][0] as { fromId: string; toId: string; cost: number }[];
    expect(next).toHaveLength(10329);
    expect(next[0]).toEqual({ fromId: "W1", toId: "C1", cost: 15 });
    expect(next[10328]).toEqual({ fromId: "W33", toId: "C10329", cost: 15507 });
    expect((onApplyCosts.mock.calls[0][1] as ReadonlySet<string>).size).toBe(10329); // the applied keys, for the size guard
  });

  it("applies only to the filtered rows and keeps every other override", () => {
    const keep = { fromId: "W1", toId: "C1", cost: 7 };
    const onApplyCosts = setup(buildPairs(120), { laneCostOverrides: [keep] });
    filterText("from", "W33");
    typeMultiplier("2");
    fireEvent.click(apply());
    expect(onApplyCosts).toHaveBeenCalledWith(
      [
        keep,
        { fromId: "W33", toId: "C33", cost: 84 },
        { fromId: "W33", toId: "C66", cost: 150 },
        { fromId: "W33", toId: "C99", cost: 216 },
      ],
      new Set(["W33|C33", "W33|C66", "W33|C99"]), // applied keys only; the kept override is not one
    );
  });

  it("is disabled when the filter matches nothing", () => {
    setup(buildPairs(40));
    filterText("from", "ZZZ");
    typeMultiplier("2");
    expect(apply()).toBeDisabled();
  });

  it("is disabled, with Workspace's reason as its title, when Workspace blocks it", () => {
    setup(buildPairs(3), { applyBlockedReason: "Save your changes first" });
    typeMultiplier("2");
    expect(apply()).toBeDisabled();
    expect(apply()).toHaveAttribute("title", "Save your changes first");
  });

  it("is read-only while browsing history", () => {
    setup(buildPairs(3), { readOnly: true });
    expect(screen.getByTestId("input-deliverycost-multiplier")).toBeDisabled();
    expect(apply()).toBeDisabled();
  });

  it("renders no multiplier without onApplyCosts", () => {
    mockReferenceCosts(buildPairs(3));
    render(<DeliveryCostsTab laneCostOverrides={[]} onChange={vi.fn()} modelId="delivery-teaching-us" />);
    expect(screen.queryByTestId("input-deliverycost-multiplier")).not.toBeInTheDocument();
  });
});
