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

// A9 (SCND correctness, §2.7.1/A8) — the export endpoint's 409 body, per
// `LegacyResultExportRejection` (openapi.yaml): a stable, permanent
// machine-readable `code` the frontend keys off of, never string-matched out
// of the human-readable `error` message. This module doesn't import the
// generated `ApiError` class (it isn't re-exported from the package index —
// see custom-fetch.ts), so it duck-types the same shape every other
// ApiError-catching call site in this codebase already relies on (e.g.
// Register.tsx's `(err as { status?: number })?.status === 409`).
const LEGACY_RESULT_REQUIRES_RESOLVE = "LEGACY_RESULT_REQUIRES_RESOLVE";

function isLegacyResolveRejection(
  err: unknown,
): err is { status: number; data: { code: string; error: string } } {
  if (typeof err !== "object" || err === null) return false;
  const candidate = err as { status?: unknown; data?: unknown };
  if (candidate.status !== 409) return false;
  const data = candidate.data;
  if (typeof data !== "object" || data === null) return false;
  return (data as { code?: unknown }).code === LEGACY_RESULT_REQUIRES_RESOLVE;
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
    // A9 — the 409 LEGACY_RESULT_REQUIRES_RESOLVE rejection is NOT a generic
    // export failure: it's a "the result predates verified solve tracking,
    // re-solve first" resolve prompt. Handled here regardless of WHICH
    // output entity's export triggered it (assignments/openWarehouses/
    // costSummary/serviceStats/flows — its exact firing scope is a pending
    // backend design decision per the task brief, so this check is entity-
    // agnostic and fires wherever the 409 appears, current or future).
    if (isLegacyResolveRejection(err)) {
      toast({
        title: "Re-solve to export",
        description: "This result predates verified solve tracking and can't be exported as output data. Re-solve the scenario, then export again.",
      });
      return;
    }
    toast({
      title: "Export failed",
      description: err instanceof Error ? err.message : "Could not export.",
      variant: "destructive",
    });
  }
}
