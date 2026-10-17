import { render as rtlRender, screen, fireEvent } from "@testing-library/react";
import type { ReactElement } from "react";
import { describe, it, expect, vi } from "vitest";
import { FlowsTab } from "@/components/workspace/tabs/FlowsTab";
import * as exportEntity from "@/lib/exportEntity";
import { UnitProvider, useDisplayUnit } from "@/contexts/UnitContext";
import { ExportProvider } from "@/contexts/ExportContext";
import { makeExportProviderValue } from "@/__tests__/helpers/renderWithExportProvider";
import { chooseDownload } from "@/__tests__/helpers/downloadMenu";

// FlowsTab now calls useDisplayUnit() unconditionally — every render needs a
// UnitProvider ancestor. Shadowing `render` keeps every existing call site
// byte-identical, same pattern as AppShell.test.tsx's renderShell.
//
// SCN chen-bands-units, Task 14b — FlowsTab now ALSO calls useExport()
// unconditionally.
function render(ui: ReactElement) {
  return rtlRender(<UnitProvider><ExportProvider value={makeExportProviderValue()}>{ui}</ExportProvider></UnitProvider>);
}

const transportResult = {
  status: "optimal" as const, objective: 100, runTimeSec: 0.5, quality: "x",
  edges: [{ fromId: "KY", toId: "CHI", flow: 500, distance: 300 }],
  metrics: {}, details: {}, solverUsed: "CBC", infeasibilityReason: null,
};

const twoEchelonResult = {
  status: "optimal" as const, objective: 100, runTimeSec: 0.5, quality: "x",
  edges: [
    { fromId: "kalgoorlie", toId: "daggar-hills", flow: 100, distance: 293.66, leg: "mine_to_refinery" as const },
    { fromId: "daggar-hills", toId: "sydney", flow: 80, distance: 2381.79, leg: "refinery_to_customer" as const },
  ],
  metrics: {}, details: {}, solverUsed: "CBC", infeasibilityReason: null,
};

const jadeResult = {
  status: "optimal" as const, objective: 254060828.6157, runTimeSec: 1.2, quality: "Proven optimal",
  edges: [
    { fromId: "plant-1", toId: "wh-11", flow: 1000, distance: 293.66, leg: "plant_to_warehouse" as const, productId: "product-1" },
    { fromId: "plant-1", toId: "wh-11", flow: 400, distance: 293.66, leg: "plant_to_warehouse" as const, productId: "product-2" },
    { fromId: "wh-11", toId: "customer-1", flow: 500, distance: 42.1, leg: "warehouse_to_customer" as const },
  ],
  metrics: {}, details: {}, solverUsed: "CBC", infeasibilityReason: null,
};

describe("FlowsTab", () => {
  it("renders one row per edge for a transport-coal result (no leg field)", () => {
    render(<FlowsTab result={transportResult} scenarioId={1} />);
    expect(screen.getByTestId("flow-row-KY-CHI")).toHaveTextContent("500");
  });

  it("shows only mine_to_refinery edges for a two-echelon result, excluding refinery_to_customer", () => {
    render(<FlowsTab result={twoEchelonResult} scenarioId={1} />);
    expect(screen.getByTestId("flow-row-kalgoorlie-daggar-hills")).toBeInTheDocument();
    expect(screen.queryByTestId("flow-row-daggar-hills-sydney")).not.toBeInTheDocument();
  });

  // jade-T14 — Chapter 9 JADE
  describe("Chapter 9 JADE — plant_to_warehouse legs, per-product", () => {
    it("shows only plant_to_warehouse edges, excluding warehouse_to_customer", () => {
      render(<FlowsTab result={jadeResult} scenarioId={1} />);
      expect(screen.getByTestId("flow-row-plant-1-wh-11-product-1")).toBeInTheDocument();
      expect(screen.getByTestId("flow-row-plant-1-wh-11-product-2")).toBeInTheDocument();
      expect(screen.queryByTestId("flow-row-wh-11-customer-1")).not.toBeInTheDocument();
    });

    it("shows a Product column with each row's productId, one row per product (not collapsed)", () => {
      render(<FlowsTab result={jadeResult} scenarioId={1} />);
      expect(screen.getByText("Product")).toBeInTheDocument();
      expect(screen.getByTestId("flow-row-plant-1-wh-11-product-1")).toHaveTextContent("product-1");
      expect(screen.getByTestId("flow-row-plant-1-wh-11-product-2")).toHaveTextContent("product-2");
      const rows = screen.getAllByTestId(/^flow-row-/);
      expect(rows).toHaveLength(2);
    });

    it("does not show a Product column for a transport-coal result (no productId anywhere)", () => {
      render(<FlowsTab result={transportResult} scenarioId={1} />);
      expect(screen.queryByText("Product")).not.toBeInTheDocument();
    });

    it("does not show a Product column for a two-echelon-gold-au result (no productId anywhere)", () => {
      render(<FlowsTab result={twoEchelonResult} scenarioId={1} />);
      expect(screen.queryByText("Product")).not.toBeInTheDocument();
    });
  });

  it("shows an empty-state message when result is null", () => {
    render(<FlowsTab result={null} scenarioId={1} />);
    expect(screen.getByTestId("flows-empty")).toBeInTheDocument();
  });

  // chen-bands-units, Part D "No fallback unit — reads": this table used to
  // hardcode "Distance (mi)" unconditionally — no `distanceUnit` passed now
  // means the canonical unit is unresolved, and the header + every row must
  // show a placeholder, never a guessed "mi".
  describe("distance unit (chen-bands-units)", () => {
    it("shows a Distance placeholder header and no row value — never a guessed 'mi' — when distanceUnit is not resolved", () => {
      render(<FlowsTab result={transportResult} scenarioId={1} />);
      expect(screen.getByText("Distance")).toBeInTheDocument();
      expect(screen.queryByText("Distance (mi)")).not.toBeInTheDocument();
      expect(screen.queryByText(/^Distance \(/)).not.toBeInTheDocument();
      const row = screen.getByTestId("flow-row-KY-CHI");
      expect(row).not.toHaveTextContent("300.0");
      expect(row).toHaveTextContent("—");
    });

    it("renders the Distance header and value in mi when explicitly resolved", () => {
      render(<FlowsTab result={transportResult} scenarioId={1} distanceUnit="mi" />);
      expect(screen.getByText("Distance (mi)")).toBeInTheDocument();
      expect(screen.getByTestId("flow-row-KY-CHI")).toHaveTextContent("300.0");
    });

    it("renders the Distance header and value in km (never mi) for a Chen-like distanceUnit", () => {
      render(<FlowsTab result={transportResult} scenarioId={1} distanceUnit="km" />);
      expect(screen.getByText("Distance (km)")).toBeInTheDocument();
      expect(screen.queryByText("Distance (mi)")).not.toBeInTheDocument();
    });

    it("does not affect the non-distance Flow value when the unit is unresolved", () => {
      render(<FlowsTab result={transportResult} scenarioId={1} />);
      expect(screen.getByTestId("flow-row-KY-CHI")).toHaveTextContent("500");
    });
  });

  it("calls downloadEntityExport with entity=flows when Download CSV is clicked", () => {
    const spy = vi.spyOn(exportEntity, "downloadEntityExport").mockResolvedValue();
    render(<FlowsTab result={transportResult} scenarioId={1} />);
    chooseDownload("button-download-flows", "button-download-flows-csv");
    expect(spy).toHaveBeenCalledWith(1, "flows", "csv", { unit: "mi" });
  });

  // Task 14b — production-control assertions.
  describe("useExport() disabled-reason wiring (Task 14b)", () => {
    it("is disabled with the reason surfaced for a result entity when the displayed entry has no runId", () => {
      rtlRender(
        <UnitProvider>
          <ExportProvider value={makeExportProviderValue({ resultDisabledReason: "No run recorded for this entry." })}>
            <FlowsTab result={transportResult} scenarioId={1} />
          </ExportProvider>
        </UnitProvider>,
      );
      const button = screen.getByTestId("button-download-flows");
      expect(button).toBeDisabled();
      expect(button).toHaveAttribute("title", "No run recorded for this entry.");
    });

    it("forwards runId when an older history entry is displayed", () => {
      const spy = vi.spyOn(exportEntity, "downloadEntityExport").mockResolvedValue();
      rtlRender(
        <UnitProvider>
          <ExportProvider value={makeExportProviderValue({ runId: 3 })}>
            <FlowsTab result={transportResult} scenarioId={1} />
          </ExportProvider>
        </UnitProvider>,
      );
      chooseDownload("button-download-flows", "button-download-flows-csv");
      expect(spy).toHaveBeenCalledWith(1, "flows", "csv", { unit: "mi", runId: 3 });
    });
  });

  // JADE — "City, ST" primary label + id mono sub-label
  describe("JADE City, ST label (locationById)", () => {
    it("shows 'City, ST' with the id kept as a sub-label for both From and To cells when locationById has entries", () => {
      render(
        <FlowsTab
          result={jadeResult}
          scenarioId={1}
          locationById={{
            "plant-1": { city: "Bethlehem", state: "PA" },
            "wh-11": { city: "Allentown", state: "PA" },
          }}
        />,
      );
      const row = screen.getByTestId("flow-row-plant-1-wh-11-product-1");
      expect(row).toHaveTextContent("Bethlehem, PA");
      expect(row).toHaveTextContent("plant-1");
      expect(row).toHaveTextContent("Allentown, PA");
      expect(row).toHaveTextContent("wh-11");
    });

    it("falls back to ID-only rendering when locationById is absent (other-model default, no regression)", () => {
      render(<FlowsTab result={transportResult} scenarioId={1} />);
      const row = screen.getByTestId("flow-row-KY-CHI");
      expect(row).toHaveTextContent("KY");
      expect(row).not.toHaveTextContent(",");
    });
  });

  // workspace-fixups-2, T10 (item 2) — identityById compat resolver
  describe("identityById (workspace-fixups-2, T10, item 2)", () => {
    it("prefers identityById over locationById for both From and To cells", () => {
      render(
        <FlowsTab
          result={jadeResult}
          scenarioId={1}
          locationById={{ "plant-1": { city: "Old", state: "XX" } }}
          identityById={{
            "plant-1": { city: "Bethlehem", state: "PA", displayId: "PLANT-1-CODE" },
            "wh-11": { city: "Allentown", state: "PA", displayId: "WH-11-CODE" },
          }}
        />,
      );
      const row = screen.getByTestId("flow-row-plant-1-wh-11-product-1");
      expect(row).toHaveTextContent("Bethlehem, PA");
      expect(row).toHaveTextContent("PLANT-1-CODE");
      expect(row).toHaveTextContent("Allentown, PA");
      expect(row).toHaveTextContent("WH-11-CODE");
    });

    // DoD: at least one previously-unwired NON-JADE model exercised — this
    // suite's transportResult (transport-coal, no `leg`, never passed
    // locationById by any existing caller) is exactly that case.
    it("shows an added FACILITY's display code via identityById for a non-JADE (transport-coal) result", () => {
      render(
        <FlowsTab
          result={transportResult}
          scenarioId={1}
          identityById={{ KY: { city: "Central City", state: "KY", displayId: "MINE-KY-01" } }}
        />,
      );
      const row = screen.getByTestId("flow-row-KY-CHI");
      expect(row).toHaveTextContent("MINE-KY-01");
      expect(row).toHaveTextContent("Central City, KY");
    });

    it("falls back to displayId, then the canonical id, on a lookup miss", () => {
      render(
        <FlowsTab
          result={transportResult}
          scenarioId={1}
          identityById={{ "some-other-id": { city: "X", state: "Y", displayId: "Z" } }}
        />,
      );
      expect(screen.getByTestId("flow-row-KY-CHI")).toHaveTextContent("KY");
    });

    it("with identityById unset, output is byte-unchanged from before this task (no-regression)", () => {
      render(<FlowsTab result={transportResult} scenarioId={1} />);
      const row = screen.getByTestId("flow-row-KY-CHI");
      expect(row).toHaveTextContent("KY");
      expect(row).not.toHaveTextContent(",");
    });
  });
});

describe("FlowsTab — no duplicate title (SCU-1.4)", () => {
  it("renders no 'Flows' title and keeps Download right-aligned", () => {
    render(<FlowsTab result={transportResult} scenarioId={1} />);
    expect(screen.queryByText("Flows", { selector: "span" })).not.toBeInTheDocument();
    const dl = screen.getByTestId("button-download-flows"); // SCU-2.P3: Download ▾ right-aligned via toolbar.downloadAlign
    expect(dl.closest("div.ml-auto")).not.toBeNull();
    expect(dl.parentElement!.lastElementChild).toBe(dl);
  });
});

// SCU-2.P3.4 (spec B2.1/B2.2/B2.4, matrix §2a "Flows") — DataTable migration.
describe("FlowsTab on DataTable — testid map (SCU-2.P3.4)", () => {
  const many = (n: number) => ({
    ...transportResult,
    edges: Array.from({ length: n }, (_, i) => ({ fromId: `M${i % 3}`, toId: `S${i + 1}`, flow: i + 1, distance: 100 + i })),
  });

  it("emits flow-row-{from}-{to} and flow-row-{from}-{to}-{product} on <tr>s; Download ▾ trigger + items", () => {
    render(<FlowsTab result={jadeResult} scenarioId={1} distanceUnit="mi" />);
    expect(screen.getByTestId("flow-row-plant-1-wh-11-product-1").tagName).toBe("TR");
    expect(screen.getByTestId("flow-row-plant-1-wh-11-product-2")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("button-download-flows"));
    expect(screen.getByTestId("button-download-flows-csv")).toBeInTheDocument();
    expect(screen.getByTestId("button-download-flows-json")).toBeInTheDocument();
  });

  it("emits flows-empty for no result", () => {
    render(<FlowsTab result={null} scenarioId={1} />);
    expect(screen.getByTestId("flows-empty")).toBeInTheDocument();
  });

  it("JSON goes through the server export (entity flows, format json)", () => {
    const spy = vi.spyOn(exportEntity, "downloadEntityExport").mockResolvedValue();
    render(<FlowsTab result={transportResult} scenarioId={1} distanceUnit="mi" />);
    chooseDownload("button-download-flows", "button-download-flows-json");
    expect(spy).toHaveBeenCalledWith(1, "flows", "json", { unit: "mi" });
    spy.mockRestore();
  });

  it("keeps header order (Product only when present) and centres Distance/Flow", () => {
    render(<FlowsTab result={transportResult} scenarioId={1} distanceUnit="mi" />);
    const heads = screen.getAllByRole("columnheader");
    expect(heads.map(h => h.textContent)).toEqual(["From", "To", "Distance (mi)", "Flow"]);
    expect(heads.map(h => h.classList.contains("text-center"))).toEqual([false, false, true, true]);
  });

  it("11 rows: filter; 51 rows: pager with the mapped literals", () => {
    const a = render(<FlowsTab result={many(11)} scenarioId={1} distanceUnit="mi" />);
    expect(screen.getByTestId("button-filter-menu-trigger")).toBeInTheDocument();
    expect(screen.queryByTestId("flows-pager")).toBeNull();
    a.unmount();
    render(<FlowsTab result={many(51)} scenarioId={1} distanceUnit="mi" />);
    expect(screen.getByTestId("flows-page-indicator")).toHaveTextContent("Page 1 of 2");
    fireEvent.click(screen.getByTestId("button-flows-next"));
    expect(screen.getByTestId("flow-row-M2-S51")).toBeInTheDocument();
    expect(screen.getByTestId("button-flows-prev")).not.toBeDisabled();
  });

  it("follows the display-unit toggle: header and values convert to the display unit", () => {
    window.localStorage.setItem("nos:display-unit-pref", "km");
    try {
      render(<FlowsTab result={transportResult} scenarioId={1} distanceUnit="mi" />);
      expect(screen.getByRole("columnheader", { name: "Distance (km)" })).toBeInTheDocument();
      expect(screen.getByTestId("flow-row-KY-CHI")).toHaveTextContent("482.8");
    } finally {
      window.localStorage.removeItem("nos:display-unit-pref");
    }
  });
  // SCU-2.R4 (decision B) — km pref filters km cells; a unit toggle resets the range.
  it("the Distance range filters km cells under a km pref and resets on a unit toggle", () => {
    function PrefToggle() {
      const u = useDisplayUnit();
      return <button data-testid="toggle-pref-mi" onClick={() => u.setPref("mi")}>mi</button>;
    }
    window.localStorage.setItem("nos:display-unit-pref", "km");
    try {
      render(<><PrefToggle /><FlowsTab result={many(12)} scenarioId={1} distanceUnit="mi" /></>);
      fireEvent.click(screen.getByTestId("button-filter-menu-trigger"));
      fireEvent.change(screen.getByTestId("input-filter-distance-max"), { target: { value: "170" } });
      expect(screen.getAllByTestId(/^flow-row-/)).toHaveLength(6);
      fireEvent.click(screen.getByTestId("toggle-pref-mi"));
      expect(screen.getAllByTestId(/^flow-row-/)).toHaveLength(12);
    } finally {
      window.localStorage.removeItem("nos:display-unit-pref");
    }
  });
});
