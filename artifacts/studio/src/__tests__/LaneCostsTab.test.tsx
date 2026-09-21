import { cloneElement, type ReactElement } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render as rtlRender, screen, fireEvent, waitFor } from "@testing-library/react";
import { AllProviders } from "@/__tests__/helpers/renderWithExportProvider";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { LaneCostsTab } from "@/components/workspace/tabs/LaneCostsTab";
import { UnitProvider, useDisplayUnit } from "@/contexts/UnitContext";
import { makeExportProviderValue } from "@/__tests__/helpers/renderWithExportProvider";
import { ExportProvider } from "@/contexts/ExportContext";

// chen-bands-units, Task 12 — every render now needs a UnitProvider ancestor.
// Shadow `render` (RTL's `wrapper` option + a default `canonicalUnit="mi"`,
// transport-coal's real canonical unit) rather than touching every one of
// this file's bare `render(<LaneCostsTab .../>)` call sites individually.
// `cost` here IS a distance (transportLp.ts:18-25 — the objective is
// literally distance x flow; "cost" is chapter vocabulary only), so it gets
// the identical default-unit treatment as every sibling tab's distance
// field, not a lesser one.
function withDefaultUnit(ui: ReactElement): ReactElement {
  const existing = (ui.props as { canonicalUnit?: unknown }).canonicalUnit;
  return cloneElement(ui, { canonicalUnit: existing !== undefined ? existing : "mi" } as Record<string, unknown>);
}
function render(ui: ReactElement, options?: Parameters<typeof rtlRender>[1]) {
  return rtlRender(withDefaultUnit(ui), { wrapper: AllProviders, ...options });
}

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
  // `withDefaultUnit` (invoked by the local `render` above) sees the
  // PROVIDER element here, not `<LaneCostsTab>` itself — call sites below
  // that use this helper set `canonicalUnit` explicitly.
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
    // chen-bands-units, Task 12 — the value cell is now `type="text"` (was
    // `type="number"`), so its committed value is a rendered STRING.
    expect(screen.getByTestId("input-lanecost-MN01-ST001")).toHaveValue("120.5");
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
    // chen-bands-units, Task 12 — commit now happens on blur/Enter, not on
    // every keystroke.
    fireEvent.change(screen.getByTestId("input-lanecost-MN01-ST001"), { target: { value: "500" } });
    fireEvent.blur(screen.getByTestId("input-lanecost-MN01-ST001"));
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
    fireEvent.blur(screen.getByTestId("input-lanecost-am-5678-ST001"));
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
        canonicalUnit="mi"
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
        canonicalUnit="mi"
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
        canonicalUnit="mi"
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

// T11 (workspace-fixups-2, item 2/Codex P1) — `identityById` compatibility
// resolver + the `>10` UPGRADE rule. This table previously had NO location
// source at all (bare `displayCodeById?.[id] ?? id`).
describe("LaneCostsTab — T11 identityById upgrade (item 2)", () => {
  function buildRows(n: number) {
    return Array.from({ length: n }, (_, i) => ({
      fromId: `MN01`,
      toId: `ST${String(i + 1).padStart(3, "0")}`,
      cost: 100 + i,
    }));
  }

  it("no-regression: with identityById UNSET, an 11-row table (past the >10 threshold) stays bare-id, byte-unchanged", () => {
    const rows = buildRows(11);
    render(
      <LaneCostsTab
        laneCostOverrides={rows}
        savedLaneCostOverrides={rows}
        mineIds={["MN01"]}
        stationIds={rows.map(r => r.toId)}
        onChange={vi.fn()}
      />,
    );
    const row = screen.getByTestId("row-lanecost-MN01-ST001");
    expect(row).toHaveTextContent("MN01");
    expect(row).toHaveTextContent("ST001");
  });

  it("upgrades to the stacked City/State + mono display-id cell once the unfiltered row count exceeds 10 AND identityById is provided", () => {
    const rows = buildRows(11);
    render(
      <LaneCostsTab
        laneCostOverrides={rows}
        savedLaneCostOverrides={rows}
        mineIds={["MN01"]}
        stationIds={rows.map(r => r.toId)}
        onChange={vi.fn()}
        identityById={{
          MN01: { city: "Beckley", state: "WV", displayId: "MINE-A" },
          ST001: { city: "Norfolk", state: "VA", displayId: "STN-A" },
        }}
      />,
    );
    const row = screen.getByTestId("row-lanecost-MN01-ST001");
    expect(row).toHaveTextContent("Beckley, WV");
    expect(row).toHaveTextContent("MINE-A");
    expect(row).toHaveTextContent("Norfolk, VA");
    expect(row).toHaveTextContent("STN-A");
  });

  it("does NOT upgrade at 10 rows or fewer, even with identityById present", () => {
    const rows = buildRows(10);
    render(
      <LaneCostsTab
        laneCostOverrides={rows}
        savedLaneCostOverrides={rows}
        mineIds={["MN01"]}
        stationIds={rows.map(r => r.toId)}
        onChange={vi.fn()}
        identityById={{ MN01: { city: "Beckley", state: "WV", displayId: "MINE-A" } }}
      />,
    );
    const row = screen.getByTestId("row-lanecost-MN01-ST001");
    expect(row).not.toHaveTextContent("Beckley, WV");
    expect(row).toHaveTextContent("MINE-A");
  });
});

// chen-bands-units, Task 12 — the display-unit draft contract, exercised
// directly against this component's value cell and add-row field. This
// block also carries the SEMANTIC regression guard: `laneCostOverrides.cost`
// values ARE distances (transportLp.ts:18-25 — the objective is literally
// distance x flow; "cost" is chapter vocabulary only, not a monetary value),
// and they DO convert under the unit toggle exactly like every sibling
// tab's distance field. A future reader must not "fix" this back to a
// non-converting field on the reasonable-sounding but wrong grounds that
// "costs aren't distances" — this test pins that claim.
function ToggleUnitButton({ to }: { to: "auto" | "km" | "mi" }) {
  const { setPref } = useDisplayUnit();
  return (
    <button data-testid={`toggle-unit-${to}`} onClick={() => setPref(to)}>
      toggle {to}
    </button>
  );
}
function renderWithToggle(ui: React.ReactElement) {
  return rtlRender(
    <UnitProvider><ExportProvider value={makeExportProviderValue()}>
      <ToggleUnitButton to="km" />
      <ToggleUnitButton to="mi" />
      <ToggleUnitButton to="auto" />
      {ui}
    </ExportProvider></UnitProvider>,
  );
}

describe("LaneCostsTab — chen-bands-units Task 12: display-unit draft contract (cost IS a distance)", () => {
  afterEach(() => {
    window.localStorage.removeItem("nos:display-unit-pref");
  });

  it("PINS THE SEMANTIC CLAIM: laneCostOverrides.cost converts under the display unit — it is a distance, not a monetary value (transportLp.ts:18-25)", () => {
    const onChange = vi.fn();
    renderWithToggle(
      <LaneCostsTab
        laneCostOverrides={[{ fromId: "MN01", toId: "ST001", cost: 10 }]}
        savedLaneCostOverrides={[{ fromId: "MN01", toId: "ST001", cost: 10 }]}
        mineIds={["MN01"]}
        stationIds={["ST001"]}
        onChange={onChange}
        canonicalUnit="km"
      />,
    );
    // Forcing the display unit to mi while the model's canonical unit is km:
    // if `cost` did NOT convert (i.e. were treated as an opaque monetary
    // figure), the stored value after committing a typed "500" would be the
    // literal 500. Because it DOES convert (it's a distance), it must come
    // out as 500 mi -> km = 804.672 canonical, exactly like every sibling
    // tab's distance field.
    fireEvent.click(screen.getByTestId("toggle-unit-mi"));
    fireEvent.change(screen.getByTestId("input-lanecost-MN01-ST001"), { target: { value: "500" } });
    fireEvent.blur(screen.getByTestId("input-lanecost-MN01-ST001"));
    expect(onChange).toHaveBeenCalledWith([{ fromId: "MN01", toId: "ST001", cost: 804.672 }]);
  });

  it("the Cost column header carries a unit suffix (it had none before this bundle)", () => {
    renderWithToggle(
      <LaneCostsTab
        laneCostOverrides={[{ fromId: "MN01", toId: "ST001", cost: 10 }]}
        savedLaneCostOverrides={[{ fromId: "MN01", toId: "ST001", cost: 10 }]}
        mineIds={["MN01"]}
        stationIds={["ST001"]}
        onChange={vi.fn()}
        canonicalUnit="mi"
      />,
    );
    expect(screen.getByText("Cost (mi)")).toBeInTheDocument();
  });

  it("an incomplete draft ('5.') never commits, even on blur", () => {
    const onChange = vi.fn();
    renderWithToggle(
      <LaneCostsTab
        laneCostOverrides={[{ fromId: "MN01", toId: "ST001", cost: 10 }]}
        savedLaneCostOverrides={[{ fromId: "MN01", toId: "ST001", cost: 10 }]}
        mineIds={["MN01"]}
        stationIds={["ST001"]}
        onChange={onChange}
        canonicalUnit="mi"
      />,
    );
    fireEvent.change(screen.getByTestId("input-lanecost-MN01-ST001"), { target: { value: "5." } });
    fireEvent.blur(screen.getByTestId("input-lanecost-MN01-ST001"));
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByTestId("input-lanecost-MN01-ST001")).toHaveValue("10");
  });

  it("a unit toggle mid-edit converts a complete draft in place and visibly discards an incomplete one", () => {
    renderWithToggle(
      <LaneCostsTab
        laneCostOverrides={[{ fromId: "MN01", toId: "ST001", cost: 10 }]}
        savedLaneCostOverrides={[{ fromId: "MN01", toId: "ST001", cost: 10 }]}
        mineIds={["MN01"]}
        stationIds={["ST001"]}
        onChange={vi.fn()}
        canonicalUnit="km"
      />,
    );
    fireEvent.change(screen.getByTestId("input-lanecost-MN01-ST001"), { target: { value: "20" } });
    fireEvent.click(screen.getByTestId("toggle-unit-mi"));
    expect(screen.getByTestId("input-lanecost-MN01-ST001")).toHaveValue("12.4274");

    fireEvent.change(screen.getByTestId("input-lanecost-MN01-ST001"), { target: { value: "5." } });
    fireEvent.click(screen.getByTestId("toggle-unit-km"));
    expect(screen.getByTestId("input-lanecost-MN01-ST001")).toHaveValue("10");
  });

  it("repeated toggling introduces no drift in the eventually-committed value", () => {
    const onChange = vi.fn();
    renderWithToggle(
      <LaneCostsTab
        laneCostOverrides={[{ fromId: "MN01", toId: "ST001", cost: 10 }]}
        savedLaneCostOverrides={[{ fromId: "MN01", toId: "ST001", cost: 10 }]}
        mineIds={["MN01"]}
        stationIds={["ST001"]}
        onChange={onChange}
        canonicalUnit="km"
      />,
    );
    fireEvent.change(screen.getByTestId("input-lanecost-MN01-ST001"), { target: { value: "20" } });
    fireEvent.click(screen.getByTestId("toggle-unit-mi"));
    fireEvent.click(screen.getByTestId("toggle-unit-km"));
    fireEvent.click(screen.getByTestId("toggle-unit-mi"));
    fireEvent.click(screen.getByTestId("toggle-unit-auto"));
    fireEvent.blur(screen.getByTestId("input-lanecost-MN01-ST001"));
    expect(onChange).toHaveBeenCalledWith([{ fromId: "MN01", toId: "ST001", cost: 20 }]);
  });

  it("the add-row form converts too — asserts the stored CANONICAL value, not the typed text", () => {
    const onChange = vi.fn();
    renderWithToggle(
      <LaneCostsTab
        laneCostOverrides={[]}
        savedLaneCostOverrides={[]}
        mineIds={["MN01"]}
        stationIds={["ST001"]}
        onChange={onChange}
        canonicalUnit="km"
      />,
    );
    fireEvent.click(screen.getByTestId("toggle-unit-mi"));
    fireEvent.click(screen.getByTestId("button-add-lanecost-row"));
    fireEvent.change(screen.getByTestId("input-new-lanecost-from"), { target: { value: "MN01" } });
    fireEvent.change(screen.getByTestId("input-new-lanecost-to"), { target: { value: "ST001" } });
    fireEvent.change(screen.getByTestId("input-new-lanecost-value"), { target: { value: "500" } });
    fireEvent.click(screen.getByTestId("button-add-lanecost-confirm"));
    expect(onChange).toHaveBeenCalledWith([{ fromId: "MN01", toId: "ST001", cost: 804.672 }]);
  });

  it("the editor is disabled and commits nothing while the canonical unit is unresolved (no fallback)", () => {
    const onChange = vi.fn();
    renderWithToggle(
      <LaneCostsTab
        laneCostOverrides={[{ fromId: "MN01", toId: "ST001", cost: 10 }]}
        savedLaneCostOverrides={[{ fromId: "MN01", toId: "ST001", cost: 10 }]}
        mineIds={["MN01"]}
        stationIds={["ST001"]}
        onChange={onChange}
        canonicalUnit={null}
      />,
    );
    const input = screen.getByTestId("input-lanecost-MN01-ST001");
    expect(input).toBeDisabled();
    fireEvent.change(input, { target: { value: "500" } });
    fireEvent.blur(input);
    expect(onChange).not.toHaveBeenCalled();
  });
});
