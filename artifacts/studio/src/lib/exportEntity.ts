import { exportScenario } from "@workspace/api-client-react";
import { toast } from "@/hooks/use-toast";

// T11 (Chapter 9 JADE) — "plants"/"plantCapabilities" added, matching T3.5's
// already-generated `ExportScenarioEntity` (openapi.yaml) exactly. This
// union is a small hand-maintained convenience type over that generated
// enum (not generated code itself), so it's the correct place to extend.
export type ExportEntity = "warehouses" | "customers" | "mines" | "stations" | "refineries" | "distances" | "laneCosts" | "legDistances" | "assignments" | "openWarehouses" | "costSummary" | "serviceStats" | "flows" | "plants" | "plantCapabilities";

// A1.3 — shared client-side download logic for the Workspace grid tabs
// (WarehousesTab, CustomersTab). Extracted rather than duplicated because
// both tabs need the identical CSV/JSON blob-download flow; behavior is
// copied verbatim from Studio.tsx's `handleExport` (which is left as-is —
// out of this task's file list, not touched).
//
// SCN chen-bands-units, Task 11b — `options` is optional and additive so
// every pre-existing 3-arg call site keeps compiling and behaving
// byte-identically (an omitted `unit`/`runId` is dropped from the query
// string by the generated client, same as before this task). `unit` is
// appended for every entity, including non-distance ones — see
// `ExportContext.tsx`'s `download()` for why no per-entity allowlist
// exists here.
export interface DownloadEntityExportOptions {
  unit?: "km" | "mi";
  runId?: number;
}

export async function downloadEntityExport(
  scenarioId: number,
  entity: ExportEntity,
  format: "csv" | "json",
  options?: DownloadEntityExportOptions,
): Promise<void> {
  try {
    const data = await exportScenario(scenarioId, {
      entity,
      format,
      unit: options?.unit,
      runId: options?.runId,
    });
    const text = typeof data === "string" ? data : JSON.stringify(data, null, 2);
    const blob = new Blob([text], { type: format === "csv" ? "text/csv" : "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${entity}.${format}`;
    a.click();
    URL.revokeObjectURL(url);
  } catch (err) {
    toast({
      title: "Export failed",
      description: err instanceof Error ? err.message : "Could not export.",
      variant: "destructive",
    });
  }
}
