import { exportScenario } from "@workspace/api-client-react";
import { toast } from "@/hooks/use-toast";

export type ExportEntity = "warehouses" | "customers" | "mines" | "stations" | "refineries";

// A1.3 — shared client-side download logic for the Workspace grid tabs
// (WarehousesTab, CustomersTab). Extracted rather than duplicated because
// both tabs need the identical CSV/JSON blob-download flow; behavior is
// copied verbatim from Studio.tsx's `handleExport` (which is left as-is —
// out of this task's file list, not touched).
export async function downloadEntityExport(
  scenarioId: number,
  entity: ExportEntity,
  format: "csv" | "json",
): Promise<void> {
  try {
    const data = await exportScenario(scenarioId, { entity, format });
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
