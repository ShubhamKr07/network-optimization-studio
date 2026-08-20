import { useState } from "react";
import type { WarehouseCandidate, Scenario } from "@workspace/api-client-react";
import { WarehouseTable, type WarehouseOverride } from "@/components/tables/WarehouseTable";
import { ImportDialog } from "@/components/ImportDialog";
import { Button } from "@/components/ui/button";
import { Download, Upload } from "lucide-react";
import { downloadEntityExport } from "@/lib/exportEntity";

interface WarehousesTabProps {
  warehouses: WarehouseCandidate[];
  overrides: WarehouseOverride[];
  capacityMode: "none" | "uniform" | "per_wh";
  onChange: (next: WarehouseOverride[]) => void;
  /** Undefined while the scenario hasn't resolved yet — Upload/Download stay disabled until it has. */
  scenarioId?: number;
  /** Fired after a successful import apply, with the updated scenario — the caller (Workspace.tsx) refreshes its inputs draft from it. */
  onImportApplied?: (scenario: Scenario) => void;
}

// A1.1 — thin Workspace-tab wrapper around the existing WarehouseTable
// (built for Studio.tsx's Overrides dialog, D2.1/D1.2). Re-homed as-is, no
// fork: WarehouseTable itself already speaks DD-6's UI vocabulary (its own
// STATUS_LABEL constant). The only behavior added here is the mine-candidate
// filter (mirrors Studio.tsx's `dataset.warehouses.filter(w => w.kind !==
// "mine")` — a mine is never a facility-location choice, so it doesn't
// belong in this table) and an empty-dataset fallback.
//
// A1.3 — Upload/Download toolbar, wired to the existing ImportDialog
// (preview -> apply flow, reused as-is) and the existing exportScenario
// fetch function (via lib/exportEntity's shared download helper) — the
// same components/flow Studio.tsx already uses, replicated here rather than
// rebuilt.
export function WarehousesTab({ warehouses, overrides, capacityMode, onChange, scenarioId, onImportApplied }: WarehousesTabProps) {
  const [importOpen, setImportOpen] = useState(false);
  const candidates = warehouses.filter(w => w.kind !== "mine");

  const toolbar = (
    <div className="flex items-center gap-1.5 mb-2" data-testid="warehouses-tab-toolbar">
      <Button
        variant="outline"
        size="sm"
        onClick={() => scenarioId != null && downloadEntityExport(scenarioId, "warehouses", "csv")}
        disabled={scenarioId == null}
        data-testid="button-export-warehouses-csv"
        className="h-7 text-xs"
      >
        <Download className="w-3.5 h-3.5 mr-1" /> CSV
      </Button>
      <Button
        variant="outline"
        size="sm"
        onClick={() => scenarioId != null && downloadEntityExport(scenarioId, "warehouses", "json")}
        disabled={scenarioId == null}
        data-testid="button-export-warehouses-json"
        className="h-7 text-xs"
      >
        <Download className="w-3.5 h-3.5 mr-1" /> JSON
      </Button>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setImportOpen(true)}
        disabled={scenarioId == null}
        data-testid="button-import-warehouses"
        className="h-7 text-xs"
      >
        <Upload className="w-3.5 h-3.5 mr-1" /> Upload
      </Button>
    </div>
  );

  // Mounted only while actually open (not always-mounted-but-closed) —
  // ImportDialog calls its preview/apply mutation hooks unconditionally on
  // render, so keeping it out of the tree until the student clicks Upload
  // avoids firing those hooks (and needing a QueryClientProvider ancestor)
  // just from opening this tab. Mirrors Studio.tsx's own
  // `{importEntity && scenarioId && <ImportDialog .../>}` gating.
  const importDialog = importOpen && scenarioId != null && (
    <ImportDialog
      open={importOpen}
      onOpenChange={setImportOpen}
      scenarioId={scenarioId}
      entity="warehouses"
      onApplied={onImportApplied}
    />
  );

  if (candidates.length === 0) {
    return (
      <div>
        {toolbar}
        <p className="text-sm text-muted-foreground" data-testid="warehouses-tab-empty">
          No warehouse candidates in this dataset.
        </p>
        {importDialog}
      </div>
    );
  }

  return (
    <div data-testid="warehouses-tab">
      {toolbar}
      <WarehouseTable warehouses={candidates} overrides={overrides} capacityMode={capacityMode} onChange={onChange} />
      {importDialog}
    </div>
  );
}
