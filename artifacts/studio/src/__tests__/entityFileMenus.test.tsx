// SCU-2.P4.1 — Upload ▾ / Download ▾ / expected-fields panel for input tables
// (spec B2.3, B2.4). ImportDialog and the export fetch are mocked: their own
// behaviour is covered by ImportDialog.test.tsx / ExportContext.test.tsx; this
// file pins the literal testids, the format each item hands on, and that the
// panel is derived from @workspace/import-schema.

import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { IMPORT_SCHEMAS, exampleCsv, exampleJsonDocument } from "@workspace/import-schema";
import { AllProviders, ExportProviderTestWrapper } from "@/__tests__/helpers/renderWithExportProvider";
import { UnitProvider } from "@/contexts/UnitContext";
import { useEntityFileMenus, type EntityFileMenusOptions } from "@/components/data-table/useEntityFileMenus";
import { allowedText, expectedFields, requiredText } from "@/components/data-table/ExpectedFieldsPanel";

const downloadEntityExport = vi.fn();
vi.mock("@/lib/exportEntity", () => ({
  downloadEntityExport: (...args: unknown[]) => downloadEntityExport(...args),
}));
vi.mock("@/components/ImportDialog", () => ({
  ImportDialog: (p: { entity: string; format: string; scenarioId: number; enableFilters?: boolean; onOpenChange: (o: boolean) => void }) => (
    <div data-testid="stub-import-dialog" data-entity={p.entity} data-format={p.format} data-scenario={p.scenarioId} data-filters={String(!!p.enableFilters)}>
      <button type="button" data-testid="stub-import-close" onClick={() => p.onOpenChange(false)} />
    </div>
  ),
}));

function Harness(props: EntityFileMenusOptions) {
  const m = useEntityFileMenus(props);
  return (
    <div>
      {m.upload}
      {m.download}
      {m.dialog}
    </div>
  );
}

beforeEach(() => downloadEntityExport.mockReset());

describe("useEntityFileMenus (SCU-2.P4.1)", () => {
  it("emits the literal Upload/Download testids and keeps today's export ids on the items", () => {
    render(<Harness entity="legDistances" testIdEntity="legdistances" scenarioId={7} />, { wrapper: AllProviders });
    expect(screen.getByTestId("button-import-legdistances")).toHaveTextContent("Upload");
    expect(screen.getByTestId("button-download-legdistances")).toHaveTextContent("Download");
    fireEvent.click(screen.getByTestId("button-download-legdistances"));
    expect(screen.getByTestId("button-export-legdistances-csv")).toHaveTextContent("CSV");
    expect(screen.getByTestId("button-export-legdistances-json")).toHaveTextContent("JSON");
    // Plain dialog (trigger announces aria-haspopup="dialog"): no menu/menuitem roles without arrow-key nav.
    expect(screen.queryByRole("menu")).toBeNull();
    expect(screen.queryAllByRole("menuitem")).toHaveLength(0);
  });

  it("Download items call the server export with the chosen format", () => {
    render(<Harness entity="distances" testIdEntity="distances" scenarioId={7} />, { wrapper: AllProviders });
    fireEvent.click(screen.getByTestId("button-download-distances"));
    fireEvent.click(screen.getByTestId("button-export-distances-json"));
    expect(downloadEntityExport).toHaveBeenCalledWith(1, "distances", "json", { unit: "mi", runId: undefined });
    fireEvent.click(screen.getByTestId("button-download-distances"));
    fireEvent.click(screen.getByTestId("button-export-distances-csv"));
    expect(downloadEntityExport).toHaveBeenLastCalledWith(1, "distances", "csv", { unit: "mi", runId: undefined });
  });

  it("Upload items open ImportDialog with the chosen format; closing unmounts it", () => {
    render(<Harness entity="deliveryCosts" testIdEntity="deliverycosts" scenarioId={7} enableFilters />, { wrapper: AllProviders });
    expect(screen.queryByTestId("stub-import-dialog")).toBeNull();
    fireEvent.click(screen.getByTestId("button-import-deliverycosts"));
    fireEvent.click(screen.getByTestId("button-import-deliverycosts-json"));
    const dialog = screen.getByTestId("stub-import-dialog");
    expect(dialog).toHaveAttribute("data-entity", "deliveryCosts");
    expect(dialog).toHaveAttribute("data-format", "json");
    expect(dialog).toHaveAttribute("data-scenario", "7");
    expect(dialog).toHaveAttribute("data-filters", "true");
    fireEvent.click(screen.getByTestId("stub-import-close"));
    expect(screen.queryByTestId("stub-import-dialog")).toBeNull();
    fireEvent.click(screen.getByTestId("button-import-deliverycosts"));
    fireEvent.click(screen.getByTestId("button-import-deliverycosts-csv"));
    expect(screen.getByTestId("stub-import-dialog")).toHaveAttribute("data-format", "csv");
  });

  it("Upload is disabled until the scenario resolves; Download carries the provider's disabled reason", () => {
    render(
      <UnitProvider>
        <ExportProviderTestWrapper value={{ inputDisabledReason: "Input exports reflect the current scenario" }}>
          <Harness entity="customers" testIdEntity="customers" />
        </ExportProviderTestWrapper>
      </UnitProvider>,
    );
    expect(screen.getByTestId("button-import-customers")).toBeDisabled();
    expect(screen.getByTestId("button-download-customers")).toBeDisabled();
    expect(screen.getByTestId("button-download-customers")).toHaveAttribute("title", "Input exports reflect the current scenario");
  });

  it("while browsing history BOTH menus are disabled with the Download reason (user decision 2026-10-17)", () => {
    render(
      <UnitProvider>
        <ExportProviderTestWrapper value={{ inputDisabledReason: "Input exports reflect the current scenario" }}>
          <Harness entity="distances" testIdEntity="distances" scenarioId={7} />
        </ExportProviderTestWrapper>
      </UnitProvider>,
    );
    for (const id of ["button-import-distances", "button-download-distances"]) {
      expect(screen.getByTestId(id)).toBeDisabled();
      expect(screen.getByTestId(id)).toHaveAttribute("title", "Input exports reflect the current scenario");
    }
  });

  it("both menus show the expected-fields panel built from @workspace/import-schema", () => {
    render(<Harness entity="warehouses" testIdEntity="warehouses" modelId="p-median-us" scenarioId={7} />, { wrapper: AllProviders });
    for (const trigger of ["button-import-warehouses", "button-download-warehouses"]) {
      fireEvent.click(screen.getByTestId(trigger));
      const panel = screen.getByTestId("expected-fields-warehouses");
      const headers = within(panel).getAllByTestId(/^expected-field-warehouses-/).map(r => r.getAttribute("data-testid"));
      expect(headers).toEqual(IMPORT_SCHEMAS.warehouses.versions[0]!.fields.map(f => `expected-field-warehouses-${f.csvHeader}`));
      expect(within(panel).getByTestId("expected-fields-warehouses-csv").textContent).toBe(exampleCsv("warehouses"));
      expect(JSON.parse(within(panel).getByTestId("expected-fields-warehouses-json").textContent ?? "")).toEqual(exampleJsonDocument("warehouses"));
      expect(within(panel).getByText("Leave id blank to add a new row.")).toBeInTheDocument();
      fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    }
  });
});

describe("expected-fields text (SCU-2.P4.1)", () => {
  it("drops fields that do not apply to the model (warehouse capacity is p-median only)", () => {
    expect(expectedFields("warehouses", "p-median-us").map(f => f.csvHeader)).toContain("capacity");
    expect(expectedFields("warehouses", "delivery-teaching-us").map(f => f.csvHeader)).not.toContain("capacity");
    expect(expectedFields("warehouses").map(f => f.csvHeader)).toContain("capacity");
  });

  it("describes required-ness, enums, bounds and the unit column", () => {
    const byHeader = (entity: "warehouses" | "distances" | "deliveryCosts", h: string) =>
      expectedFields(entity).find(f => f.csvHeader === h)!;
    expect(requiredText(byHeader("warehouses", "id"))).toBe("update rows");
    expect(requiredText(byHeader("warehouses", "city"))).toBe("add rows");
    expect(requiredText(byHeader("warehouses", "status"))).toBe("always");
    expect(requiredText(byHeader("warehouses", "display_code"))).toBe("optional");
    expect(allowedText(byHeader("warehouses", "status"))).toBe("active | forced_open | inactive");
    expect(allowedText(byHeader("distances", "distance"))).toBe("> 0; in the file's unit");
    expect(allowedText(byHeader("distances", "unit"))).toBe("km | mi; JSON: may come from the envelope's unit");
    expect(allowedText(byHeader("deliveryCosts", "cost"))).toBe("≥ 0");
  });
});
