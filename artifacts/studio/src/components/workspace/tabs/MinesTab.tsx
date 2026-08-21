import { useState } from "react";
import type { Scenario } from "@workspace/api-client-react";
import { MineTable, type MineOverride } from "@/components/tables/MineTable";
import { ImportDialog } from "@/components/ImportDialog";
import { Button } from "@/components/ui/button";
import { Download, Upload } from "lucide-react";
import { downloadEntityExport } from "@/lib/exportEntity";

interface MineRow { id: string; city: string; state: string; }

interface MinesTabProps {
  mines: MineRow[];
  overrides: MineOverride[];
  onChange: (next: MineOverride[]) => void;
  /** Undefined while the scenario hasn't resolved yet — Upload/Download stay disabled until it has. */
  scenarioId?: number;
  /** Fired after a successful import apply, with the updated scenario — the caller (Workspace.tsx) refreshes its inputs draft from it. */
  onImportApplied?: (scenario: Scenario) => void;
}

// A5.1 — transport-coal's Mines input tab. Same shape as WarehousesTab/
// CustomersTab (A1.1/A1.3): a thin wrapper around the existing MineTable
// (built for Studio.tsx's Overrides dialog) plus an Upload/Download toolbar
// wired to entity="mines" — the backend's import/export routes already
// accept it (routes/scenarios.ts), this is purely the frontend registration
// closing model-integration-precheck.md's Gate 1.9 gap for this model.
export function MinesTab({ mines, overrides, onChange, scenarioId, onImportApplied }: MinesTabProps) {
  const [importOpen, setImportOpen] = useState(false);

  const toolbar = (
    <div className="flex items-center gap-1.5 mb-2" data-testid="mines-tab-toolbar">
      <Button
        variant="outline"
        size="sm"
        onClick={() => scenarioId != null && downloadEntityExport(scenarioId, "mines", "csv")}
        disabled={scenarioId == null}
        data-testid="button-export-mines-csv"
        className="h-7 text-xs"
      >
        <Download className="w-3.5 h-3.5 mr-1" /> CSV
      </Button>
      <Button
        variant="outline"
        size="sm"
        onClick={() => scenarioId != null && downloadEntityExport(scenarioId, "mines", "json")}
        disabled={scenarioId == null}
        data-testid="button-export-mines-json"
        className="h-7 text-xs"
      >
        <Download className="w-3.5 h-3.5 mr-1" /> JSON
      </Button>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setImportOpen(true)}
        disabled={scenarioId == null}
        data-testid="button-import-mines"
        className="h-7 text-xs"
      >
        <Upload className="w-3.5 h-3.5 mr-1" /> Upload
      </Button>
    </div>
  );

  const importDialog = importOpen && scenarioId != null && (
    <ImportDialog
      open={importOpen}
      onOpenChange={setImportOpen}
      scenarioId={scenarioId}
      entity="mines"
      onApplied={onImportApplied}
    />
  );

  if (mines.length === 0) {
    return (
      <div>
        {toolbar}
        <p className="text-sm text-muted-foreground" data-testid="mines-tab-empty">
          No mines in this dataset.
        </p>
        {importDialog}
      </div>
    );
  }

  return (
    <div data-testid="mines-tab">
      {toolbar}
      <MineTable mines={mines} overrides={overrides} onChange={onChange} />
      {importDialog}
    </div>
  );
}
