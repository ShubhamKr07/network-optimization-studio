import { cloneElement, type ReactElement } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render as rtlRender, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { LegDistancesTab } from "@/components/workspace/tabs/LegDistancesTab";
import { UnitProvider, useDisplayUnit } from "@/contexts/UnitContext";

// chen-bands-units, Task 12 — every render now needs a UnitProvider ancestor
// (useDistanceDraft/useDisplayUnit throw without one). Rather than touching
// every one of this file's ~25 bare `render(<LegDistancesTab .../>)` call
// sites, shadow the `render` import itself: RTL's `wrapper` OPTION (not a
// JSX-wrapping element, which is lost across `rerender()`) plus a default
// `canonicalUnit="mi"` (two-echelon-gold-au's real canonical unit) injected
// via cloneElement unless a test's own JSX already sets it explicitly.
function withDefaultUnit(ui: ReactElement): ReactElement {
  const existing = (ui.props as { canonicalUnit?: unknown }).canonicalUnit;
  return cloneElement(ui, { canonicalUnit: existing !== undefined ? existing : "mi" } as Record<string, unknown>);
}
function render(ui: ReactElement, options?: Parameters<typeof rtlRender>[1]) {
  return rtlRender(withDefaultUnit(ui), { wrapper: UnitProvider, ...options });
}

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
  // Note: wrapping `ui` in `<QueryClientProvider>` here means `withDefaultUnit`
  // (invoked by the local `render` above) sees the PROVIDER element, not
  // `<LegDistancesTab>` itself, so `canonicalUnit` is defaulted at each call
  // site below instead (this component has no reference-distance query, so
  // QueryClientProvider is only needed for ImportDialog's own hooks).
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
    // chen-bands-units, Task 12 — the value cell is now `type="text"` (was
    // `type="number"`), so its committed value is a rendered STRING, not a
    // number.
    expect(screen.getByTestId("input-legdistance-kalgoorlie-daggar-hills")).toHaveValue("293.7");
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
    // chen-bands-units, Task 12 — commit now happens on blur/Enter, not on
    // every keystroke.
    fireEvent.change(screen.getByTestId("input-legdistance-kalgoorlie-daggar-hills"), { target: { value: "500" } });
    fireEvent.blur(screen.getByTestId("input-legdistance-kalgoorlie-daggar-hills"));
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

// Followup — displayCodeById: an added refinery's uid shows its human-
// readable displayCode in the From/To columns; base ids (never present in
// the map) keep showing the raw id. The underlying stored row (and what
// onChange receives on edit, and leg resolution) always stays keyed by the
// uid — displayCodeById only affects what's rendered.
describe("LegDistancesTab — displayCodeById (Followup)", () => {
  const addedRefineryIds = [...refineryIds, "ar-9012"];

  it("renders an added refinery's displayCode instead of its raw uid", () => {
    const uidOverrides = [{ fromId: "ar-9012", toId: "sydney", distance: 55 }];
    render(
      <LegDistancesTab
        distanceOverrides={uidOverrides}
        savedDistanceOverrides={uidOverrides}
        mineIds={mineIds}
        refineryIds={addedRefineryIds}
        customerIds={customerIds}
        onChange={vi.fn()}
        displayCodeById={{ "ar-9012": "RF-QLD-CUNNAMULLA-02" }}
      />,
    );
    const row = screen.getByTestId("row-legdistance-ar-9012-sydney");
    expect(row).toHaveTextContent("RF-QLD-CUNNAMULLA-02");
    expect(row).not.toHaveTextContent("ar-9012");
  });

  it("falls back to the raw id for a base dataset id with no displayCode entry", () => {
    render(
      <LegDistancesTab
        distanceOverrides={overrides}
        savedDistanceOverrides={overrides}
        mineIds={mineIds}
        refineryIds={refineryIds}
        customerIds={customerIds}
        onChange={vi.fn()}
        displayCodeById={{ "ar-9012": "RF-QLD-CUNNAMULLA-02" }}
      />,
    );
    expect(screen.getByTestId("row-legdistance-kalgoorlie-daggar-hills")).toHaveTextContent("kalgoorlie");
  });

  it("editing an added refinery's row still writes the uid-keyed row to onChange, not the displayCode", () => {
    const onChange = vi.fn();
    const uidOverrides = [{ fromId: "ar-9012", toId: "sydney", distance: 55 }];
    render(
      <LegDistancesTab
        distanceOverrides={uidOverrides}
        savedDistanceOverrides={uidOverrides}
        mineIds={mineIds}
        refineryIds={addedRefineryIds}
        customerIds={customerIds}
        onChange={onChange}
        displayCodeById={{ "ar-9012": "RF-QLD-CUNNAMULLA-02" }}
      />,
    );
    fireEvent.change(screen.getByTestId("input-legdistance-ar-9012-sydney"), { target: { value: "99" } });
    fireEvent.blur(screen.getByTestId("input-legdistance-ar-9012-sydney"));
    expect(onChange).toHaveBeenCalledWith([{ fromId: "ar-9012", toId: "sydney", distance: 99 }]);
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
        canonicalUnit="mi"
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
        canonicalUnit="mi"
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
        canonicalUnit="mi"
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

// T11 (workspace-fixups-2, item 2/Codex P1) — `identityById` compatibility
// resolver + the `>10` UPGRADE rule. This table previously had NO location
// source at all (bare `displayCodeById?.[id] ?? id`), unlike DistancesTab's
// Chen path or JadeDistancesTab's always-rich path.
describe("LegDistancesTab — T11 identityById upgrade (item 2)", () => {
  function buildRows(n: number) {
    return Array.from({ length: n }, (_, i) => ({
      fromId: `kalgoorlie`,
      toId: `refinery-${i + 1}`,
      distance: 100 + i,
    }));
  }

  it("no-regression: with identityById UNSET, an 11-row table (past the >10 threshold) stays bare-id, byte-unchanged", () => {
    const rows = buildRows(11);
    render(
      <LegDistancesTab
        distanceOverrides={rows}
        savedDistanceOverrides={rows}
        mineIds={mineIds}
        refineryIds={rows.map(r => r.toId)}
        customerIds={customerIds}
        onChange={vi.fn()}
      />,
    );
    const row = screen.getByTestId("row-legdistance-kalgoorlie-refinery-1");
    expect(row).toHaveTextContent("kalgoorlie");
    expect(row).toHaveTextContent("refinery-1");
  });

  it("upgrades to the stacked City/State + mono display-id cell once the unfiltered row count exceeds 10 AND identityById is provided", () => {
    const rows = buildRows(11);
    render(
      <LegDistancesTab
        distanceOverrides={rows}
        savedDistanceOverrides={rows}
        mineIds={mineIds}
        refineryIds={rows.map(r => r.toId)}
        customerIds={customerIds}
        onChange={vi.fn()}
        identityById={{
          kalgoorlie: { city: "Kalgoorlie", state: "WA", displayId: "MINE-1" },
          "refinery-1": { city: "Toowoomba", state: "QLD", displayId: "RF-A" },
        }}
      />,
    );
    const row = screen.getByTestId("row-legdistance-kalgoorlie-refinery-1");
    expect(row).toHaveTextContent("Kalgoorlie, WA");
    expect(row).toHaveTextContent("MINE-1");
    expect(row).toHaveTextContent("Toowoomba, QLD");
    expect(row).toHaveTextContent("RF-A");
  });

  it("does NOT upgrade at 10 rows or fewer, even with identityById present", () => {
    const rows = buildRows(10);
    render(
      <LegDistancesTab
        distanceOverrides={rows}
        savedDistanceOverrides={rows}
        mineIds={mineIds}
        refineryIds={rows.map(r => r.toId)}
        customerIds={customerIds}
        onChange={vi.fn()}
        identityById={{ kalgoorlie: { city: "Kalgoorlie", state: "WA", displayId: "MINE-1" } }}
      />,
    );
    const row = screen.getByTestId("row-legdistance-kalgoorlie-refinery-1");
    expect(row).not.toHaveTextContent("Kalgoorlie, WA");
    expect(row).toHaveTextContent("MINE-1");
  });
});

// chen-bands-units, Task 12 — the display-unit draft contract, exercised
// directly against this component's value cell and add-row field.
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
    <UnitProvider>
      <ToggleUnitButton to="km" />
      <ToggleUnitButton to="mi" />
      <ToggleUnitButton to="auto" />
      {ui}
    </UnitProvider>,
  );
}

describe("LegDistancesTab — chen-bands-units Task 12: display-unit draft contract", () => {
  afterEach(() => {
    window.localStorage.removeItem("nos:display-unit-pref");
  });

  it("a display-unit entry commits the correct CANONICAL value (typing 500 under a forced mi display in a km-canonical model stores 804.672)", () => {
    const onChange = vi.fn();
    renderWithToggle(
      <LegDistancesTab
        distanceOverrides={[{ fromId: "kalgoorlie", toId: "daggar-hills", distance: 10 }]}
        savedDistanceOverrides={[{ fromId: "kalgoorlie", toId: "daggar-hills", distance: 10 }]}
        mineIds={mineIds}
        refineryIds={refineryIds}
        customerIds={customerIds}
        onChange={onChange}
        canonicalUnit="km"
      />,
    );
    fireEvent.click(screen.getByTestId("toggle-unit-mi"));
    fireEvent.change(screen.getByTestId("input-legdistance-kalgoorlie-daggar-hills"), { target: { value: "500" } });
    fireEvent.blur(screen.getByTestId("input-legdistance-kalgoorlie-daggar-hills"));
    expect(onChange).toHaveBeenCalledWith([{ fromId: "kalgoorlie", toId: "daggar-hills", distance: 804.672 }]);
  });

  it("an incomplete draft ('5.') never commits, even on blur", () => {
    const onChange = vi.fn();
    renderWithToggle(
      <LegDistancesTab
        distanceOverrides={[{ fromId: "kalgoorlie", toId: "daggar-hills", distance: 10 }]}
        savedDistanceOverrides={[{ fromId: "kalgoorlie", toId: "daggar-hills", distance: 10 }]}
        mineIds={mineIds}
        refineryIds={refineryIds}
        customerIds={customerIds}
        onChange={onChange}
        canonicalUnit="mi"
      />,
    );
    fireEvent.change(screen.getByTestId("input-legdistance-kalgoorlie-daggar-hills"), { target: { value: "5." } });
    fireEvent.blur(screen.getByTestId("input-legdistance-kalgoorlie-daggar-hills"));
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByTestId("input-legdistance-kalgoorlie-daggar-hills")).toHaveValue("10");
  });

  it("a unit toggle mid-edit converts a complete draft in place and visibly discards an incomplete one", () => {
    renderWithToggle(
      <LegDistancesTab
        distanceOverrides={[{ fromId: "kalgoorlie", toId: "daggar-hills", distance: 10 }]}
        savedDistanceOverrides={[{ fromId: "kalgoorlie", toId: "daggar-hills", distance: 10 }]}
        mineIds={mineIds}
        refineryIds={refineryIds}
        customerIds={customerIds}
        onChange={vi.fn()}
        canonicalUnit="km"
      />,
    );
    fireEvent.change(screen.getByTestId("input-legdistance-kalgoorlie-daggar-hills"), { target: { value: "20" } });
    fireEvent.click(screen.getByTestId("toggle-unit-mi"));
    expect(screen.getByTestId("input-legdistance-kalgoorlie-daggar-hills")).toHaveValue("12.4274");

    fireEvent.change(screen.getByTestId("input-legdistance-kalgoorlie-daggar-hills"), { target: { value: "5." } });
    fireEvent.click(screen.getByTestId("toggle-unit-km"));
    expect(screen.getByTestId("input-legdistance-kalgoorlie-daggar-hills")).toHaveValue("10");
  });

  it("repeated toggling introduces no drift in the eventually-committed value", () => {
    const onChange = vi.fn();
    renderWithToggle(
      <LegDistancesTab
        distanceOverrides={[{ fromId: "kalgoorlie", toId: "daggar-hills", distance: 10 }]}
        savedDistanceOverrides={[{ fromId: "kalgoorlie", toId: "daggar-hills", distance: 10 }]}
        mineIds={mineIds}
        refineryIds={refineryIds}
        customerIds={customerIds}
        onChange={onChange}
        canonicalUnit="km"
      />,
    );
    fireEvent.change(screen.getByTestId("input-legdistance-kalgoorlie-daggar-hills"), { target: { value: "20" } });
    fireEvent.click(screen.getByTestId("toggle-unit-mi"));
    fireEvent.click(screen.getByTestId("toggle-unit-km"));
    fireEvent.click(screen.getByTestId("toggle-unit-mi"));
    fireEvent.click(screen.getByTestId("toggle-unit-auto"));
    fireEvent.blur(screen.getByTestId("input-legdistance-kalgoorlie-daggar-hills"));
    expect(onChange).toHaveBeenCalledWith([{ fromId: "kalgoorlie", toId: "daggar-hills", distance: 20 }]);
  });

  it("the add-row form converts too — asserts the stored CANONICAL value, not the typed text", () => {
    const onChange = vi.fn();
    renderWithToggle(
      <LegDistancesTab
        distanceOverrides={[]}
        savedDistanceOverrides={[]}
        mineIds={mineIds}
        refineryIds={refineryIds}
        customerIds={customerIds}
        onChange={onChange}
        canonicalUnit="km"
      />,
    );
    fireEvent.click(screen.getByTestId("toggle-unit-mi"));
    fireEvent.click(screen.getByTestId("button-add-legdistance-row"));
    fireEvent.change(screen.getByTestId("input-new-legdistance-from"), { target: { value: "kalgoorlie" } });
    fireEvent.change(screen.getByTestId("input-new-legdistance-to"), { target: { value: "daggar-hills" } });
    fireEvent.change(screen.getByTestId("input-new-legdistance-value"), { target: { value: "500" } });
    fireEvent.click(screen.getByTestId("button-add-legdistance-confirm"));
    expect(onChange).toHaveBeenCalledWith([{ fromId: "kalgoorlie", toId: "daggar-hills", distance: 804.672 }]);
  });

  it("the editor is disabled and commits nothing while the canonical unit is unresolved (no fallback)", () => {
    const onChange = vi.fn();
    renderWithToggle(
      <LegDistancesTab
        distanceOverrides={[{ fromId: "kalgoorlie", toId: "daggar-hills", distance: 10 }]}
        savedDistanceOverrides={[{ fromId: "kalgoorlie", toId: "daggar-hills", distance: 10 }]}
        mineIds={mineIds}
        refineryIds={refineryIds}
        customerIds={customerIds}
        onChange={onChange}
        canonicalUnit={null}
      />,
    );
    const input = screen.getByTestId("input-legdistance-kalgoorlie-daggar-hills");
    expect(input).toBeDisabled();
    fireEvent.change(input, { target: { value: "500" } });
    fireEvent.blur(input);
    expect(onChange).not.toHaveBeenCalled();
  });
});
