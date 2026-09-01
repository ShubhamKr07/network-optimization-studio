import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { LaneCostsTab } from "@/components/workspace/tabs/LaneCostsTab";

// Task 30 (B6.1 stage 4) — Lane costs grid tab: long-format
// `{fromId, toId, cost}` rows (transport-coal's laneCostOverrides), no fixed
// baseline to enumerate (mirrors DistancesTab.test.tsx's own reasoning
// exactly — same test shapes, field name/vocabulary aside).

const overrides = [
  { fromId: "MN01", toId: "ST001", cost: 120.5 },
  { fromId: "MN01", toId: "ST002", cost: 340 },
  { fromId: "MN02", toId: "ST001", cost: 88 },
];

const fetchMock = vi.fn();
global.fetch = fetchMock as unknown as typeof fetch;

function jsonResponse(body: unknown, contentType = "application/json") {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": contentType } });
}

function renderWithQueryClient(ui: React.ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  fetchMock.mockReset();
  (global.URL.createObjectURL as unknown) = vi.fn(() => "blob:mock");
  (global.URL.revokeObjectURL as unknown) = vi.fn();
});

describe("LaneCostsTab — rendering", () => {
  it("renders the scenario's current laneCostOverrides rows", () => {
    render(
      <LaneCostsTab
        laneCostOverrides={overrides}
        savedLaneCostOverrides={overrides}
        mineIds={["MN01", "MN02"]}
        stationIds={["ST001", "ST002"]}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByTestId("row-lanecost-MN01-ST001")).toBeInTheDocument();
    expect(screen.getByTestId("row-lanecost-MN01-ST002")).toBeInTheDocument();
    expect(screen.getByTestId("row-lanecost-MN02-ST001")).toBeInTheDocument();
    expect(screen.getByTestId("input-lanecost-MN01-ST001")).toHaveValue(120.5);
  });

  it("shows an empty message plus the add-row affordance when there are no overrides yet", () => {
    render(
      <LaneCostsTab
        laneCostOverrides={[]}
        savedLaneCostOverrides={[]}
        mineIds={["MN01"]}
        stationIds={["ST001"]}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByTestId("lanecosts-tab-empty")).toBeInTheDocument();
    expect(screen.getByTestId("button-add-lanecost-row")).toBeInTheDocument();
  });
});

describe("LaneCostsTab — from/to filters", () => {
  it("filters visible rows by the from-id filter text", () => {
    render(
      <LaneCostsTab
        laneCostOverrides={overrides}
        savedLaneCostOverrides={overrides}
        mineIds={["MN01", "MN02"]}
        stationIds={["ST001", "ST002"]}
        onChange={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByTestId("input-filter-from"), { target: { value: "MN02" } });
    expect(screen.queryByTestId("row-lanecost-MN01-ST001")).not.toBeInTheDocument();
    expect(screen.queryByTestId("row-lanecost-MN01-ST002")).not.toBeInTheDocument();
    expect(screen.getByTestId("row-lanecost-MN02-ST001")).toBeInTheDocument();
  });

  it("filters visible rows by the to-id filter text", () => {
    render(
      <LaneCostsTab
        laneCostOverrides={overrides}
        savedLaneCostOverrides={overrides}
        mineIds={["MN01", "MN02"]}
        stationIds={["ST001", "ST002"]}
        onChange={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByTestId("input-filter-to"), { target: { value: "ST002" } });
    expect(screen.queryByTestId("row-lanecost-MN01-ST001")).not.toBeInTheDocument();
    expect(screen.getByTestId("row-lanecost-MN01-ST002")).toBeInTheDocument();
    expect(screen.queryByTestId("row-lanecost-MN02-ST001")).not.toBeInTheDocument();
  });
});

describe("LaneCostsTab — inline edit", () => {
  it("editing a row's cost value calls onChange with the updated array, leaving other rows untouched", () => {
    const onChange = vi.fn();
    render(
      <LaneCostsTab
        laneCostOverrides={overrides}
        savedLaneCostOverrides={overrides}
        mineIds={["MN01", "MN02"]}
        stationIds={["ST001", "ST002"]}
        onChange={onChange}
      />,
    );
    fireEvent.change(screen.getByTestId("input-lanecost-MN01-ST001"), { target: { value: "500" } });
    expect(onChange).toHaveBeenCalledWith([
      { fromId: "MN01", toId: "ST001", cost: 500 },
      { fromId: "MN01", toId: "ST002", cost: 340 },
      { fromId: "MN02", toId: "ST001", cost: 88 },
    ]);
  });

  it("removing a row calls onChange with that row dropped", () => {
    const onChange = vi.fn();
    render(
      <LaneCostsTab
        laneCostOverrides={overrides}
        savedLaneCostOverrides={overrides}
        mineIds={["MN01", "MN02"]}
        stationIds={["ST001", "ST002"]}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByTestId("button-remove-lanecost-MN01-ST001"));
    expect(onChange).toHaveBeenCalledWith([
      { fromId: "MN01", toId: "ST002", cost: 340 },
      { fromId: "MN02", toId: "ST001", cost: 88 },
    ]);
  });
});

describe("LaneCostsTab — changed-row highlight", () => {
  it("marks a row changed when its cost differs from the saved baseline", () => {
    const edited = [{ fromId: "MN01", toId: "ST001", cost: 999 }, overrides[1], overrides[2]];
    render(
      <LaneCostsTab
        laneCostOverrides={edited}
        savedLaneCostOverrides={overrides}
        mineIds={["MN01", "MN02"]}
        stationIds={["ST001", "ST002"]}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByTestId("badge-lanecost-changed-MN01-ST001")).toBeInTheDocument();
    expect(screen.queryByTestId("badge-lanecost-changed-MN01-ST002")).not.toBeInTheDocument();
  });

  it("marks a brand-new row (absent from the saved baseline) as changed", () => {
    const withNew = [...overrides, { fromId: "MN02", toId: "ST002", cost: 42 }];
    render(
      <LaneCostsTab
        laneCostOverrides={withNew}
        savedLaneCostOverrides={overrides}
        mineIds={["MN01", "MN02"]}
        stationIds={["ST001", "ST002"]}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByTestId("badge-lanecost-changed-MN02-ST002")).toBeInTheDocument();
  });

  it("a row unchanged from the saved baseline has no changed badge", () => {
    render(
      <LaneCostsTab
        laneCostOverrides={overrides}
        savedLaneCostOverrides={overrides}
        mineIds={["MN01", "MN02"]}
        stationIds={["ST001", "ST002"]}
        onChange={vi.fn()}
      />,
    );
    expect(screen.queryByTestId("badge-lanecost-changed-MN01-ST001")).not.toBeInTheDocument();
  });
});

describe("LaneCostsTab — add row", () => {
  it("adding a new row via the form produces a new laneCostOverrides entry", async () => {
    const onChange = vi.fn();
    render(
      <LaneCostsTab
        laneCostOverrides={overrides}
        savedLaneCostOverrides={overrides}
        mineIds={["MN01", "MN02"]}
        stationIds={["ST001", "ST002"]}
        onChange={onChange}
      />,
    );
    await userEvent.click(screen.getByTestId("button-add-lanecost-row"));
    await userEvent.type(screen.getByTestId("input-new-lanecost-from"), "MN02");
    await userEvent.type(screen.getByTestId("input-new-lanecost-to"), "ST002");
    await userEvent.type(screen.getByTestId("input-new-lanecost-value"), "77");
    await userEvent.click(screen.getByTestId("button-add-lanecost-confirm"));

    expect(onChange).toHaveBeenCalledWith([...overrides, { fromId: "MN02", toId: "ST002", cost: 77 }]);
  });

  it("rejects an add with a missing id or non-positive cost, without calling onChange", async () => {
    const onChange = vi.fn();
    render(
      <LaneCostsTab
        laneCostOverrides={overrides}
        savedLaneCostOverrides={overrides}
        mineIds={["MN01", "MN02"]}
        stationIds={["ST001", "ST002"]}
        onChange={onChange}
      />,
    );
    await userEvent.click(screen.getByTestId("button-add-lanecost-row"));
    await userEvent.type(screen.getByTestId("input-new-lanecost-to"), "ST002");
    await userEvent.type(screen.getByTestId("input-new-lanecost-value"), "77");
    await userEvent.click(screen.getByTestId("button-add-lanecost-confirm"));

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByTestId("text-add-lanecost-error")).toBeInTheDocument();
  });

  it("rejects an add that duplicates an existing (fromId, toId) pair", async () => {
    const onChange = vi.fn();
    render(
      <LaneCostsTab
        laneCostOverrides={overrides}
        savedLaneCostOverrides={overrides}
        mineIds={["MN01", "MN02"]}
        stationIds={["ST001", "ST002"]}
        onChange={onChange}
      />,
    );
    await userEvent.click(screen.getByTestId("button-add-lanecost-row"));
    await userEvent.type(screen.getByTestId("input-new-lanecost-from"), "MN01");
    await userEvent.type(screen.getByTestId("input-new-lanecost-to"), "ST001");
    await userEvent.type(screen.getByTestId("input-new-lanecost-value"), "77");
    await userEvent.click(screen.getByTestId("button-add-lanecost-confirm"));

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByTestId("text-add-lanecost-error")).toBeInTheDocument();
  });
});

describe("LaneCostsTab — client-side reference validation (nice-to-have)", () => {
  it("shows an inline warning for a fromId that doesn't resolve against known mines", () => {
    const badOverrides = [{ fromId: "GHOST", toId: "ST001", cost: 100 }];
    render(
      <LaneCostsTab
        laneCostOverrides={badOverrides}
        savedLaneCostOverrides={badOverrides}
        mineIds={["MN01", "MN02"]}
        stationIds={["ST001", "ST002"]}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByTestId("warning-unknown-from-GHOST-ST001")).toBeInTheDocument();
  });

  it("shows an inline warning for a toId that doesn't resolve against known stations", () => {
    const badOverrides = [{ fromId: "MN01", toId: "GHOST", cost: 100 }];
    render(
      <LaneCostsTab
        laneCostOverrides={badOverrides}
        savedLaneCostOverrides={badOverrides}
        mineIds={["MN01", "MN02"]}
        stationIds={["ST001", "ST002"]}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByTestId("warning-unknown-to-MN01-GHOST")).toBeInTheDocument();
  });

  it("does not warn for a row whose ids both resolve", () => {
    render(
      <LaneCostsTab
        laneCostOverrides={overrides}
        savedLaneCostOverrides={overrides}
        mineIds={["MN01", "MN02"]}
        stationIds={["ST001", "ST002"]}
        onChange={vi.fn()}
      />,
    );
    expect(screen.queryByTestId("warning-unknown-from-MN01-ST001")).not.toBeInTheDocument();
    expect(screen.queryByTestId("warning-unknown-to-MN01-ST001")).not.toBeInTheDocument();
  });
});

// Followup — displayCodeById: added-entity uids show their human-readable
// displayCode in the From/To columns; base ids (never present in the map)
// keep showing the raw id. The underlying stored row (and what onChange
// receives on edit) always stays keyed by the uid.
describe("LaneCostsTab — displayCodeById (Followup)", () => {
  it("renders an added entity's displayCode instead of its raw uid", () => {
    const uidOverrides = [{ fromId: "am-5678", toId: "ST001", cost: 55 }];
    render(
      <LaneCostsTab
        laneCostOverrides={uidOverrides}
        savedLaneCostOverrides={uidOverrides}
        mineIds={["am-5678"]}
        stationIds={["ST001"]}
        onChange={vi.fn()}
        displayCodeById={{ "am-5678": "MN-CO-DENVER-01" }}
      />,
    );
    const row = screen.getByTestId("row-lanecost-am-5678-ST001");
    expect(row).toHaveTextContent("MN-CO-DENVER-01");
    expect(row).not.toHaveTextContent("am-5678");
  });

  it("falls back to the raw id for a base dataset id with no displayCode entry", () => {
    render(
      <LaneCostsTab
        laneCostOverrides={overrides}
        savedLaneCostOverrides={overrides}
        mineIds={["MN01", "MN02"]}
        stationIds={["ST001", "ST002"]}
        onChange={vi.fn()}
        displayCodeById={{ "am-5678": "MN-CO-DENVER-01" }}
      />,
    );
    expect(screen.getByTestId("row-lanecost-MN01-ST001")).toHaveTextContent("MN01");
  });

  it("editing an added entity's row still writes the uid-keyed row to onChange, not the displayCode", () => {
    const onChange = vi.fn();
    const uidOverrides = [{ fromId: "am-5678", toId: "ST001", cost: 55 }];
    render(
      <LaneCostsTab
        laneCostOverrides={uidOverrides}
        savedLaneCostOverrides={uidOverrides}
        mineIds={["am-5678"]}
        stationIds={["ST001"]}
        onChange={onChange}
        displayCodeById={{ "am-5678": "MN-CO-DENVER-01" }}
      />,
    );
    fireEvent.change(screen.getByTestId("input-lanecost-am-5678-ST001"), { target: { value: "99" } });
    expect(onChange).toHaveBeenCalledWith([{ fromId: "am-5678", toId: "ST001", cost: 99 }]);
  });
});

describe("LaneCostsTab — Upload/Download (mirrors DistancesTab's wiring)", () => {
  it("Upload/Download are disabled until a scenario is resolved", () => {
    render(
      <LaneCostsTab
        laneCostOverrides={overrides}
        savedLaneCostOverrides={overrides}
        mineIds={["MN01", "MN02"]}
        stationIds={["ST001", "ST002"]}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByTestId("button-export-lanecosts-csv")).toBeDisabled();
    expect(screen.getByTestId("button-export-lanecosts-json")).toBeDisabled();
    expect(screen.getByTestId("button-import-lanecosts")).toBeDisabled();
  });

  it("Download CSV triggers the export fetch scoped to entity=laneCosts&format=csv", async () => {
    fetchMock.mockResolvedValue(new Response("fromId,toId,cost\nMN01,ST001,120.5", { status: 200, headers: { "content-type": "text/csv" } }));
    renderWithQueryClient(
      <LaneCostsTab
        laneCostOverrides={overrides}
        savedLaneCostOverrides={overrides}
        mineIds={["MN01", "MN02"]}
        stationIds={["ST001", "ST002"]}
        onChange={vi.fn()}
        scenarioId={7}
      />,
    );

    await userEvent.click(screen.getByTestId("button-export-lanecosts-csv"));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/scenarios/7/export");
    expect(String(url)).toContain("entity=laneCosts");
    expect(String(url)).toContain("format=csv");
  });

  it("Upload button opens ImportDialog scoped to entity=laneCosts", async () => {
    renderWithQueryClient(
      <LaneCostsTab
        laneCostOverrides={overrides}
        savedLaneCostOverrides={overrides}
        mineIds={["MN01", "MN02"]}
        stationIds={["ST001", "ST002"]}
        onChange={vi.fn()}
        scenarioId={7}
      />,
    );

    expect(screen.queryByText("Import laneCosts")).not.toBeInTheDocument();
    await userEvent.click(screen.getByTestId("button-import-lanecosts"));
    expect(screen.getByText("Import laneCosts")).toBeInTheDocument();
    expect(screen.getByTestId("input-import-file-laneCosts")).toBeInTheDocument();
  });

  it("a successful import apply calls onImportApplied with the updated scenario", async () => {
    const updatedScenario = { id: 7, name: "S", modelId: "transport-coal", inputs: {}, result: null, createdAt: "x", updatedAt: "x" };
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/import")) return jsonResponse({ errors: [], changes: [{ id: "MN01|ST001", line: 2, before: {}, after: {} }], warnings: [] });
      if (url.endsWith("/import/apply")) return jsonResponse({ applied: 1, errors: [], scenario: updatedScenario });
      throw new Error(`Unhandled fetch in test: ${url}`);
    });
    const onImportApplied = vi.fn();
    renderWithQueryClient(
      <LaneCostsTab
        laneCostOverrides={overrides}
        savedLaneCostOverrides={overrides}
        mineIds={["MN01", "MN02"]}
        stationIds={["ST001", "ST002"]}
        onChange={vi.fn()}
        scenarioId={7}
        onImportApplied={onImportApplied}
      />,
    );

    await userEvent.click(screen.getByTestId("button-import-lanecosts"));
    const file = new File(["fromId,toId,cost\nMN01,ST001,120.5"], "laneCosts.csv", { type: "text/csv" });
    await userEvent.upload(screen.getByTestId("input-import-file-laneCosts"), file);
    await waitFor(() => expect(screen.getByTestId("button-import-confirm")).toBeInTheDocument());

    await userEvent.click(screen.getByTestId("button-import-confirm"));

    await waitFor(() => expect(onImportApplied).toHaveBeenCalledWith(updatedScenario));
  });
});
