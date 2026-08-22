import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { LegDistancesTab } from "@/components/workspace/tabs/LegDistancesTab";

// B6.2 stage 4 — Leg distances grid tab: long-format `{fromId, toId,
// distance}` rows covering BOTH legs (mine->refinery, refinery->customer),
// no fixed baseline to enumerate (mirrors DistancesTab.test.tsx/
// LaneCostsTab.test.tsx's own reasoning — same test shapes, plus the
// leg-badge coverage neither sibling tab needs).

const mineIds = ["kalgoorlie"];
const refineryIds = ["daggar-hills", "cunnamulla"];
const customerIds = ["sydney", "melbourne"];

const overrides = [
  { fromId: "kalgoorlie", toId: "daggar-hills", distance: 293.7 },
  { fromId: "cunnamulla", toId: "sydney", distance: 610.5 },
  { fromId: "daggar-hills", toId: "melbourne", distance: 2019.2 },
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

describe("LegDistancesTab — rendering", () => {
  it("renders the scenario's current distanceOverrides rows", () => {
    render(
      <LegDistancesTab
        distanceOverrides={overrides}
        savedDistanceOverrides={overrides}
        mineIds={mineIds}
        refineryIds={refineryIds}
        customerIds={customerIds}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByTestId("row-legdistance-kalgoorlie-daggar-hills")).toBeInTheDocument();
    expect(screen.getByTestId("row-legdistance-cunnamulla-sydney")).toBeInTheDocument();
    expect(screen.getByTestId("row-legdistance-daggar-hills-melbourne")).toBeInTheDocument();
    expect(screen.getByTestId("input-legdistance-kalgoorlie-daggar-hills")).toHaveValue(293.7);
  });

  it("shows an empty message plus the add-row affordance when there are no overrides yet", () => {
    render(
      <LegDistancesTab
        distanceOverrides={[]}
        savedDistanceOverrides={[]}
        mineIds={mineIds}
        refineryIds={refineryIds}
        customerIds={customerIds}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByTestId("legdistances-tab-empty")).toBeInTheDocument();
    expect(screen.getByTestId("button-add-legdistance-row")).toBeInTheDocument();
  });
});

describe("LegDistancesTab — leg badge", () => {
  it("labels a mine->refinery pair correctly", () => {
    render(
      <LegDistancesTab
        distanceOverrides={overrides}
        savedDistanceOverrides={overrides}
        mineIds={mineIds}
        refineryIds={refineryIds}
        customerIds={customerIds}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByTestId("badge-leg-kalgoorlie-daggar-hills")).toHaveTextContent("Mine → Refinery");
  });

  it("labels a refinery->customer pair correctly", () => {
    render(
      <LegDistancesTab
        distanceOverrides={overrides}
        savedDistanceOverrides={overrides}
        mineIds={mineIds}
        refineryIds={refineryIds}
        customerIds={customerIds}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByTestId("badge-leg-cunnamulla-sydney")).toHaveTextContent("Refinery → Customer");
  });

  it("flags a pair that resolves as neither leg as unrecognized", () => {
    const badOverrides = [{ fromId: "kalgoorlie", toId: "sydney", distance: 999 }];
    render(
      <LegDistancesTab
        distanceOverrides={badOverrides}
        savedDistanceOverrides={badOverrides}
        mineIds={mineIds}
        refineryIds={refineryIds}
        customerIds={customerIds}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByTestId("badge-leg-kalgoorlie-sydney")).toHaveTextContent("Unrecognized pair");
  });
});

describe("LegDistancesTab — from/to filters", () => {
  it("filters visible rows by the from-id filter text", () => {
    render(
      <LegDistancesTab
        distanceOverrides={overrides}
        savedDistanceOverrides={overrides}
        mineIds={mineIds}
        refineryIds={refineryIds}
        customerIds={customerIds}
        onChange={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByTestId("input-filter-from"), { target: { value: "cunnamulla" } });
    expect(screen.queryByTestId("row-legdistance-kalgoorlie-daggar-hills")).not.toBeInTheDocument();
    expect(screen.getByTestId("row-legdistance-cunnamulla-sydney")).toBeInTheDocument();
  });

  it("filters visible rows by the to-id filter text", () => {
    render(
      <LegDistancesTab
        distanceOverrides={overrides}
        savedDistanceOverrides={overrides}
        mineIds={mineIds}
        refineryIds={refineryIds}
        customerIds={customerIds}
        onChange={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByTestId("input-filter-to"), { target: { value: "melbourne" } });
    expect(screen.queryByTestId("row-legdistance-kalgoorlie-daggar-hills")).not.toBeInTheDocument();
    expect(screen.getByTestId("row-legdistance-daggar-hills-melbourne")).toBeInTheDocument();
  });
});

describe("LegDistancesTab — inline edit", () => {
  it("editing a row's distance value calls onChange with the updated array", () => {
    const onChange = vi.fn();
    render(
      <LegDistancesTab
        distanceOverrides={overrides}
        savedDistanceOverrides={overrides}
        mineIds={mineIds}
        refineryIds={refineryIds}
        customerIds={customerIds}
        onChange={onChange}
      />,
    );
    fireEvent.change(screen.getByTestId("input-legdistance-kalgoorlie-daggar-hills"), { target: { value: "500" } });
    expect(onChange).toHaveBeenCalledWith([
      { fromId: "kalgoorlie", toId: "daggar-hills", distance: 500 },
      overrides[1],
      overrides[2],
    ]);
  });

  it("removing a row calls onChange with that row dropped", () => {
    const onChange = vi.fn();
    render(
      <LegDistancesTab
        distanceOverrides={overrides}
        savedDistanceOverrides={overrides}
        mineIds={mineIds}
        refineryIds={refineryIds}
        customerIds={customerIds}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByTestId("button-remove-legdistance-kalgoorlie-daggar-hills"));
    expect(onChange).toHaveBeenCalledWith([overrides[1], overrides[2]]);
  });
});

describe("LegDistancesTab — changed-row highlight", () => {
  it("marks a row changed when its distance differs from the saved baseline", () => {
    const edited = [{ fromId: "kalgoorlie", toId: "daggar-hills", distance: 1 }, overrides[1], overrides[2]];
    render(
      <LegDistancesTab
        distanceOverrides={edited}
        savedDistanceOverrides={overrides}
        mineIds={mineIds}
        refineryIds={refineryIds}
        customerIds={customerIds}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByTestId("badge-legdistance-changed-kalgoorlie-daggar-hills")).toBeInTheDocument();
    expect(screen.queryByTestId("badge-legdistance-changed-cunnamulla-sydney")).not.toBeInTheDocument();
  });
});

describe("LegDistancesTab — add row", () => {
  it("adding a new mine->refinery row via the form produces a new entry", async () => {
    const onChange = vi.fn();
    render(
      <LegDistancesTab
        distanceOverrides={overrides}
        savedDistanceOverrides={overrides}
        mineIds={mineIds}
        refineryIds={refineryIds}
        customerIds={customerIds}
        onChange={onChange}
      />,
    );
    await userEvent.click(screen.getByTestId("button-add-legdistance-row"));
    await userEvent.type(screen.getByTestId("input-new-legdistance-from"), "kalgoorlie");
    await userEvent.type(screen.getByTestId("input-new-legdistance-to"), "cunnamulla");
    await userEvent.type(screen.getByTestId("input-new-legdistance-value"), "1464.5");
    await userEvent.click(screen.getByTestId("button-add-legdistance-confirm"));

    expect(onChange).toHaveBeenCalledWith([...overrides, { fromId: "kalgoorlie", toId: "cunnamulla", distance: 1464.5 }]);
  });

  it("rejects an add whose pair resolves as neither leg, without calling onChange", async () => {
    const onChange = vi.fn();
    render(
      <LegDistancesTab
        distanceOverrides={overrides}
        savedDistanceOverrides={overrides}
        mineIds={mineIds}
        refineryIds={refineryIds}
        customerIds={customerIds}
        onChange={onChange}
      />,
    );
    await userEvent.click(screen.getByTestId("button-add-legdistance-row"));
    await userEvent.type(screen.getByTestId("input-new-legdistance-from"), "kalgoorlie");
    await userEvent.type(screen.getByTestId("input-new-legdistance-to"), "sydney");
    await userEvent.type(screen.getByTestId("input-new-legdistance-value"), "99");
    await userEvent.click(screen.getByTestId("button-add-legdistance-confirm"));

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByTestId("text-add-legdistance-error")).toBeInTheDocument();
  });

  it("rejects an add that duplicates an existing (fromId, toId) pair", async () => {
    const onChange = vi.fn();
    render(
      <LegDistancesTab
        distanceOverrides={overrides}
        savedDistanceOverrides={overrides}
        mineIds={mineIds}
        refineryIds={refineryIds}
        customerIds={customerIds}
        onChange={onChange}
      />,
    );
    await userEvent.click(screen.getByTestId("button-add-legdistance-row"));
    await userEvent.type(screen.getByTestId("input-new-legdistance-from"), "kalgoorlie");
    await userEvent.type(screen.getByTestId("input-new-legdistance-to"), "daggar-hills");
    await userEvent.type(screen.getByTestId("input-new-legdistance-value"), "77");
    await userEvent.click(screen.getByTestId("button-add-legdistance-confirm"));

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByTestId("text-add-legdistance-error")).toBeInTheDocument();
  });

  it("rejects an add with a missing id or non-positive distance, without calling onChange", async () => {
    const onChange = vi.fn();
    render(
      <LegDistancesTab
        distanceOverrides={overrides}
        savedDistanceOverrides={overrides}
        mineIds={mineIds}
        refineryIds={refineryIds}
        customerIds={customerIds}
        onChange={onChange}
      />,
    );
    await userEvent.click(screen.getByTestId("button-add-legdistance-row"));
    await userEvent.type(screen.getByTestId("input-new-legdistance-to"), "cunnamulla");
    await userEvent.type(screen.getByTestId("input-new-legdistance-value"), "77");
    await userEvent.click(screen.getByTestId("button-add-legdistance-confirm"));

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByTestId("text-add-legdistance-error")).toBeInTheDocument();
  });
});

describe("LegDistancesTab — Upload/Download (mirrors LaneCostsTab's wiring)", () => {
  it("Upload/Download are disabled until a scenario is resolved", () => {
    render(
      <LegDistancesTab
        distanceOverrides={overrides}
        savedDistanceOverrides={overrides}
        mineIds={mineIds}
        refineryIds={refineryIds}
        customerIds={customerIds}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByTestId("button-export-legdistances-csv")).toBeDisabled();
    expect(screen.getByTestId("button-export-legdistances-json")).toBeDisabled();
    expect(screen.getByTestId("button-import-legdistances")).toBeDisabled();
  });

  it("Download CSV triggers the export fetch scoped to entity=legDistances&format=csv", async () => {
    fetchMock.mockResolvedValue(new Response("from_id,to_id,distance\nkalgoorlie,daggar-hills,293.7", { status: 200, headers: { "content-type": "text/csv" } }));
    renderWithQueryClient(
      <LegDistancesTab
        distanceOverrides={overrides}
        savedDistanceOverrides={overrides}
        mineIds={mineIds}
        refineryIds={refineryIds}
        customerIds={customerIds}
        onChange={vi.fn()}
        scenarioId={7}
      />,
    );

    await userEvent.click(screen.getByTestId("button-export-legdistances-csv"));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/scenarios/7/export");
    expect(String(url)).toContain("entity=legDistances");
    expect(String(url)).toContain("format=csv");
  });

  it("Upload button opens ImportDialog scoped to entity=legDistances", async () => {
    renderWithQueryClient(
      <LegDistancesTab
        distanceOverrides={overrides}
        savedDistanceOverrides={overrides}
        mineIds={mineIds}
        refineryIds={refineryIds}
        customerIds={customerIds}
        onChange={vi.fn()}
        scenarioId={7}
      />,
    );

    expect(screen.queryByText("Import legDistances")).not.toBeInTheDocument();
    await userEvent.click(screen.getByTestId("button-import-legdistances"));
    expect(screen.getByText("Import legDistances")).toBeInTheDocument();
    expect(screen.getByTestId("input-import-file-legDistances")).toBeInTheDocument();
  });

  it("a successful import apply calls onImportApplied with the updated scenario", async () => {
    const updatedScenario = { id: 7, name: "S", modelId: "two-echelon-gold-au", inputs: {}, result: null, createdAt: "x", updatedAt: "x" };
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/import")) return jsonResponse({ errors: [], changes: [{ id: "kalgoorlie|daggar-hills", line: 2, before: {}, after: {} }], warnings: [] });
      if (url.endsWith("/import/apply")) return jsonResponse({ applied: 1, errors: [], scenario: updatedScenario });
      throw new Error(`Unhandled fetch in test: ${url}`);
    });
    const onImportApplied = vi.fn();
    renderWithQueryClient(
      <LegDistancesTab
        distanceOverrides={overrides}
        savedDistanceOverrides={overrides}
        mineIds={mineIds}
        refineryIds={refineryIds}
        customerIds={customerIds}
        onChange={vi.fn()}
        scenarioId={7}
        onImportApplied={onImportApplied}
      />,
    );

    await userEvent.click(screen.getByTestId("button-import-legdistances"));
    const file = new File(["template_version,from_id,to_id,distance\n1,kalgoorlie,daggar-hills,293.7"], "legDistances.csv", { type: "text/csv" });
    await userEvent.upload(screen.getByTestId("input-import-file-legDistances"), file);
    await waitFor(() => expect(screen.getByTestId("button-import-confirm")).toBeInTheDocument());

    await userEvent.click(screen.getByTestId("button-import-confirm"));

    await waitFor(() => expect(onImportApplied).toHaveBeenCalledWith(updatedScenario));
  });
});
