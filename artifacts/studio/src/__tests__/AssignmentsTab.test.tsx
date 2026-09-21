import { render as rtlRender, screen, fireEvent } from "@testing-library/react";
import type { ReactElement } from "react";
import { describe, it, expect, vi } from "vitest";
import { AssignmentsTab } from "@/components/workspace/tabs/AssignmentsTab";
import * as exportEntity from "@/lib/exportEntity";
import { UnitProvider } from "@/contexts/UnitContext";
import { ExportProvider } from "@/contexts/ExportContext";
import { makeExportProviderValue } from "@/__tests__/helpers/renderWithExportProvider";

// AssignmentsTab now calls useDisplayUnit() unconditionally — every render
// needs a UnitProvider ancestor. Shadowing `render` (rather than wrapping
// each of this file's many call sites individually) keeps every existing
// call site byte-identical, same pattern as AppShell.test.tsx's renderShell.
//
// SCN chen-bands-units, Task 14b — AssignmentsTab now ALSO calls useExport()
// unconditionally, so this shadow additionally wraps ExportProvider with
// Task 11b's default value ({scenarioId: 1, unit: "mi"}, matching every
// existing test's own scenarioId={1} prop).
function render(ui: ReactElement) {
  return rtlRender(<UnitProvider><ExportProvider value={makeExportProviderValue()}>{ui}</ExportProvider></UnitProvider>);
}

const result = {
  status: "optimal" as const, objective: 100, runTimeSec: 0.5, quality: "Proven optimal",
  edges: [
    { fromId: "ALN", toId: "C1", flow: 205375, distance: 42.1, band: 0 },
    { fromId: "DAL", toId: "C2", flow: 150000, distance: 812.4, band: 3 },
  ],
  metrics: {}, details: {}, solverUsed: "CBC", infeasibilityReason: null,
};

describe("AssignmentsTab", () => {
  it("renders one row per edge with warehouseId/customerId/distance/flow", () => {
    // chen-bands-units, Part D — a real caller (Workspace.tsx) always
    // resolves a canonical unit before rendering; explicit here so this test
    // keeps asserting a rendered distance value under the new no-fallback
    // contract (an unresolved unit renders a placeholder, not a number).
    render(<AssignmentsTab result={result} scenarioId={1} distanceUnit="mi" />);
    expect(screen.getByTestId("assignment-row-C1")).toHaveTextContent("ALN");
    expect(screen.getByTestId("assignment-row-C1")).toHaveTextContent("42.1");
    expect(screen.getByTestId("assignment-row-C2")).toHaveTextContent("DAL");
  });

  it("shows an empty-state message when result is null", () => {
    render(<AssignmentsTab result={null} scenarioId={1} />);
    expect(screen.getByTestId("assignments-empty")).toBeInTheDocument();
  });

  // chen-bands-units, Part D "No fallback unit — reads": no `distanceUnit`
  // passed means the canonical unit is unresolved — the header and every row
  // must show a placeholder, never a guessed "mi" (intentional change from
  // the pre-existing "defaults to mi" expectation).
  it("shows a Distance placeholder header and no row value — never a guessed 'mi' — when distanceUnit is not resolved", () => {
    const { container } = render(<AssignmentsTab result={result} scenarioId={1} />);
    expect(screen.getByText("Distance")).toBeInTheDocument();
    expect(screen.queryByText("Distance (mi)")).not.toBeInTheDocument();
    expect(container.querySelector("thead")?.textContent).not.toContain("(km)");
    expect(container.querySelector("thead")?.textContent).not.toContain("(mi)");
    expect(screen.getByTestId("assignment-row-C1")).not.toHaveTextContent("42.1");
    expect(screen.getByTestId("assignment-row-C1")).toHaveTextContent("—");
  });

  it("renders the Distance header in km (never mi) for a Chen scenario (distanceUnit=km)", () => {
    render(<AssignmentsTab result={result} scenarioId={1} distanceUnit="km" />);
    expect(screen.getByText("Distance (km)")).toBeInTheDocument();
    expect(screen.queryByText("Distance (mi)")).not.toBeInTheDocument();
  });

  it("calls downloadEntityExport with entity=assignments when Download CSV is clicked", () => {
    const spy = vi.spyOn(exportEntity, "downloadEntityExport").mockResolvedValue();
    render(<AssignmentsTab result={result} scenarioId={1} />);
    fireEvent.click(screen.getByTestId("button-download-assignments-csv"));
    expect(spy).toHaveBeenCalledWith(1, "assignments", "csv", { unit: "mi" });
  });

  // Task 14b — production-control assertions.
  describe("useExport() disabled-reason wiring (Task 14b)", () => {
    it("is disabled with the reason surfaced for a result entity when the displayed entry has no runId", () => {
      rtlRender(
        <UnitProvider>
          <ExportProvider value={makeExportProviderValue({ resultDisabledReason: "No run recorded for this entry." })}>
            <AssignmentsTab result={result} scenarioId={1} />
          </ExportProvider>
        </UnitProvider>,
      );
      const button = screen.getByTestId("button-download-assignments-csv");
      expect(button).toBeDisabled();
      expect(button).toHaveAttribute("title", "No run recorded for this entry.");
    });

    it("forwards runId when an older history entry is displayed, omits it for the latest", () => {
      const spy = vi.spyOn(exportEntity, "downloadEntityExport").mockResolvedValue();
      rtlRender(
        <UnitProvider>
          <ExportProvider value={makeExportProviderValue({ runId: 9 })}>
            <AssignmentsTab result={result} scenarioId={1} />
          </ExportProvider>
        </UnitProvider>,
      );
      fireEvent.click(screen.getByTestId("button-download-assignments-csv"));
      expect(spy).toHaveBeenCalledWith(1, "assignments", "csv", { unit: "mi", runId: 9 });
    });
  });

  // B2.2-T6 — B6: added-entity display ID
  describe("added-entity display ID", () => {
    it("shows a user-created warehouse's display ID (not its uid) from displayedInputs.addedWarehouses", () => {
      const withAdded = {
        ...result,
        edges: [{ fromId: "aw-abc123", toId: "C9", flow: 500, distance: 3 }],
      };
      render(
        <AssignmentsTab
          result={withAdded}
          scenarioId={1}
          displayedInputs={{ addedWarehouses: [{ id: "aw-abc123", displayCode: "WH-CO-DENVER-01" }] }}
        />,
      );
      const row = screen.getByTestId("assignment-row-C9");
      expect(row).toHaveTextContent("WH-CO-DENVER-01");
      expect(row).not.toHaveTextContent("aw-abc123");
    });

    it("shows an added two-echelon refinery's display ID from displayedInputs.addedRefineries (same aw- uid family)", () => {
      const withRefinery = {
        ...result,
        edges: [{ fromId: "aw-xyz789", toId: "C9", flow: 500, distance: 3 }],
      };
      render(
        <AssignmentsTab
          result={withRefinery}
          scenarioId={1}
          displayedInputs={{ addedRefineries: [{ id: "aw-xyz789", displayCode: "RF-AU-CUNN-01" }] }}
        />,
      );
      const row = screen.getByTestId("assignment-row-C9");
      expect(row).toHaveTextContent("RF-AU-CUNN-01");
      expect(row).not.toHaveTextContent("aw-xyz789");
    });

    it("falls back to the raw id when no displayCode entry exists for it (base dataset rows), and displayedInputs is optional", () => {
      render(<AssignmentsTab result={result} scenarioId={1} />);
      expect(screen.getByTestId("assignment-row-C1")).toHaveTextContent("ALN");
    });
  });

  // jade-T14 — semantic-leg classification (Chapter 9 JADE)
  describe("Chapter 9 JADE — facility->demand leg classification", () => {
    const jadeResult = {
      status: "optimal" as const, objective: 254060828.6157, runTimeSec: 1.2, quality: "Proven optimal",
      edges: [
        { fromId: "plant-1", toId: "wh-11", flow: 1000, distance: 293.66, leg: "plant_to_warehouse" as const, productId: "product-1" },
        { fromId: "wh-11", toId: "customer-1", flow: 500, distance: 42.1, leg: "warehouse_to_customer" as const },
        { fromId: "wh-14", toId: "customer-2", flow: 300, distance: 812.4, leg: "warehouse_to_customer" as const },
      ],
      metrics: {}, details: {}, solverUsed: "CBC", infeasibilityReason: null,
    };

    it("shows only warehouse_to_customer edges, excluding plant_to_warehouse", () => {
      render(<AssignmentsTab result={jadeResult} scenarioId={1} />);
      expect(screen.getByTestId("assignment-row-customer-1")).toHaveTextContent("wh-11");
      expect(screen.getByTestId("assignment-row-customer-2")).toHaveTextContent("wh-14");
      expect(screen.queryByTestId("assignment-row-wh-11")).not.toBeInTheDocument();
    });

    it("renders exactly one row per customer (aggregated, not per-edge)", () => {
      render(<AssignmentsTab result={jadeResult} scenarioId={1} />);
      const rows = screen.getAllByTestId(/^assignment-row-/);
      expect(rows).toHaveLength(2);
    });

    it("aggregates multiple facility->demand edges for the same customer into one row (defensive; JADE's own envelope is already single-source)", () => {
      const multiEdgeSameCustomer = {
        ...jadeResult,
        edges: [
          ...jadeResult.edges,
          { fromId: "wh-11", toId: "customer-1", flow: 100, distance: 42.1, leg: "warehouse_to_customer" as const },
        ],
      };
      render(<AssignmentsTab result={multiEdgeSameCustomer} scenarioId={1} />);
      const rows = screen.getAllByTestId(/^assignment-row-/);
      expect(rows).toHaveLength(2);
      expect(screen.getByTestId("assignment-row-customer-1")).toHaveTextContent("600");
    });
  });

  // JADE — "City, ST" primary label + id/displayCode mono sub-label
  describe("JADE City, ST label (locationById)", () => {
    it("shows 'City, ST' with the id kept as a sub-label for both customer and warehouse cells when locationById has entries", () => {
      render(
        <AssignmentsTab
          result={result}
          scenarioId={1}
          locationById={{
            C1: { city: "Springfield", state: "IL" },
            ALN: { city: "Allentown", state: "PA" },
          }}
        />,
      );
      const row = screen.getByTestId("assignment-row-C1");
      expect(row).toHaveTextContent("Springfield, IL");
      expect(row).toHaveTextContent("C1");
      expect(row).toHaveTextContent("Allentown, PA");
      expect(row).toHaveTextContent("ALN");
    });

    it("falls back to ID-only rendering when locationById is absent (other-model default, no regression)", () => {
      render(<AssignmentsTab result={result} scenarioId={1} />);
      const row = screen.getByTestId("assignment-row-C1");
      expect(row).toHaveTextContent("ALN");
      expect(row).not.toHaveTextContent("Springfield");
    });
  });

  // ch4-tab-city-labels — Chen (state: "") city-only label, no trailing ", "
  describe("Chen city-only label (locationById, state: \"\")", () => {
    it("shows the city with no trailing comma/space for both customer and warehouse cells", () => {
      render(
        <AssignmentsTab
          result={result}
          scenarioId={1}
          locationById={{
            C1: { city: "Shenzhen", state: "" },
            ALN: { city: "Guangzhou", state: "" },
          }}
        />,
      );
      const row = screen.getByTestId("assignment-row-C1");
      expect(row).toHaveTextContent("Shenzhen");
      expect(row).toHaveTextContent("C1");
      expect(row).toHaveTextContent("Guangzhou");
      expect(row).toHaveTextContent("ALN");
      expect(row.textContent).not.toMatch(/Shenzhen,/);
      expect(row.textContent).not.toMatch(/Guangzhou,/);
    });
  });

  // workspace-fixups-2, T10 (item 2) — identityById compat resolver
  describe("identityById (workspace-fixups-2, T10, item 2)", () => {
    it("prefers identityById over locationById/codeById for both customer and warehouse cells", () => {
      render(
        <AssignmentsTab
          result={result}
          scenarioId={1}
          locationById={{ C1: { city: "Old City", state: "OS" } }}
          displayedInputs={{ addedWarehouses: [{ id: "ALN", displayCode: "OLD-CODE" }] }}
          identityById={{
            C1: { city: "Springfield", state: "IL", displayId: "CUST-C1" },
            ALN: { city: "Allentown", state: "PA", displayId: "WH-ALN-NEW" },
          }}
        />,
      );
      const row = screen.getByTestId("assignment-row-C1");
      expect(row).toHaveTextContent("Springfield, IL");
      expect(row).toHaveTextContent("CUST-C1");
      expect(row).toHaveTextContent("Allentown, PA");
      expect(row).toHaveTextContent("WH-ALN-NEW");
    });

    it("shows an added CUSTOMER's display code (not the canonical uid) via identityById", () => {
      const withAddedCustomer = {
        ...result,
        edges: [{ fromId: "ALN", toId: "ac-9", flow: 500, distance: 3 }],
      };
      render(
        <AssignmentsTab
          result={withAddedCustomer}
          scenarioId={1}
          identityById={{ "ac-9": { city: "Boise", state: "ID", displayId: "C-ID-BOISE-01" } }}
        />,
      );
      const row = screen.getByTestId("assignment-row-ac-9");
      expect(row).toHaveTextContent("C-ID-BOISE-01");
      expect(row).not.toHaveTextContent("ac-9");
    });

    it("shows an added FACILITY's display code (not the canonical uid) via identityById", () => {
      const withAddedFacility = {
        ...result,
        edges: [{ fromId: "aw-9", toId: "C1", flow: 500, distance: 3 }],
      };
      render(
        <AssignmentsTab
          result={withAddedFacility}
          scenarioId={1}
          identityById={{ "aw-9": { city: "Denver", state: "CO", displayId: "WH-CO-DENVER-01" } }}
        />,
      );
      const row = screen.getByTestId("assignment-row-C1");
      expect(row).toHaveTextContent("WH-CO-DENVER-01");
      expect(row).not.toHaveTextContent("aw-9");
    });

    it("falls back to displayId, then the canonical id, on a lookup miss (identityById has no entry for the id)", () => {
      render(
        <AssignmentsTab
          result={result}
          scenarioId={1}
          identityById={{ "some-other-id": { city: "X", state: "Y", displayId: "Z" } }}
        />,
      );
      expect(screen.getByTestId("assignment-row-C1")).toHaveTextContent("ALN");
    });

    it("with identityById unset, output is byte-unchanged from before this task (no-regression)", () => {
      render(<AssignmentsTab result={result} scenarioId={1} />);
      const row = screen.getByTestId("assignment-row-C1");
      expect(row).toHaveTextContent("ALN");
      expect(row).not.toHaveTextContent("Springfield");
    });
  });

  // B2.2-T6 — snapshot invariant
  it("does not reflect an unsaved localInputs-style edit that was never passed via displayedInputs", () => {
    // Same rationale as OpenWarehousesTab's equivalent test: this component
    // reads ONLY `displayedInputs`, never anything resembling `localInputs`
    // — an unsaved edit the student hasn't saved yet must have zero effect
    // on what's rendered here.
    const withAdded = {
      ...result,
      edges: [{ fromId: "aw-abc123", toId: "C9", flow: 500, distance: 3 }],
    };
    const savedSnapshot = { addedWarehouses: [{ id: "aw-abc123", displayCode: "WH-CO-DENVER-01" }] };
    const unsavedLocalEdit = { addedWarehouses: [{ id: "aw-abc123", displayCode: "WH-CO-DENVER-99-DRAFT" }] }; // never passed
    void unsavedLocalEdit;
    render(<AssignmentsTab result={withAdded} scenarioId={1} displayedInputs={savedSnapshot} />);
    const row = screen.getByTestId("assignment-row-C9");
    expect(row).toHaveTextContent("WH-CO-DENVER-01");
    expect(row).not.toHaveTextContent("WH-CO-DENVER-99-DRAFT");
  });
});
