import { useState } from "react";
import type { Scenario } from "@workspace/api-client-react";
import { StationTable, type StationOverride } from "@/components/tables/StationTable";
import { ImportDialog } from "@/components/ImportDialog";
import { Button } from "@/components/ui/button";
import { Download, Upload } from "lucide-react";
import { downloadEntityExport } from "@/lib/exportEntity";

interface StationRow { id: string; city: string; state: string; }

interface StationsTabProps {
  stations: StationRow[];
  overrides: StationOverride[];
  onChange: (next: StationOverride[]) => void;
  /** Undefined while the scenario hasn't resolved yet — Upload/Download stay disabled until it has. */
  scenarioId?: number;
  /** Fired after a successful import apply, with the updated scenario — the caller (Workspace.tsx) refreshes its inputs draft from it. */
  onImportApplied?: (scenario: Scenario) => void;
}

// A5.1 — transport-coal's Stations input tab. Mirrors MinesTab (same file
// shape as WarehousesTab/CustomersTab) — a thin wrapper around the existing
// StationTable plus an Upload/Download toolbar wired to entity="stations".
export function StationsTab({ stations, overrides, onChange, scenarioId, onImportApplied }: StationsTabProps) {
  const [importOpen, setImportOpen] = useState(false);

  const toolbar = (
    <div className="flex items-center gap-1.5 mb-2" data-testid="stations-tab-toolbar">
      <Button
        variant="outline"
        size="sm"
        onClick={() => scenarioId != null && downloadEntityExport(scenarioId, "stations", "csv")}
        disabled={scenarioId == null}
        data-testid="button-export-stations-csv"
        className="h-7 text-xs"
      >
        <Download className="w-3.5 h-3.5 mr-1" /> CSV
      </Button>
      <Button
        variant="outline"
        size="sm"
        onClick={() => scenarioId != null && downloadEntityExport(scenarioId, "stations", "json")}
        disabled={scenarioId == null}
        data-testid="button-export-stations-json"
        className="h-7 text-xs"
      >
        <Download className="w-3.5 h-3.5 mr-1" /> JSON
      </Button>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setImportOpen(true)}
        disabled={scenarioId == null}
        data-testid="button-import-stations"
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
      entity="stations"
      onApplied={onImportApplied}
    />
  );

  if (stations.length === 0) {
    return (
      <div>
        {toolbar}
        <p className="text-sm text-muted-foreground" data-testid="stations-tab-empty">
          No stations in this dataset.
        </p>
        {importDialog}
      </div>
    );
  }

  return (
    <div data-testid="stations-tab">
      {toolbar}
      <StationTable stations={stations} overrides={overrides} onChange={onChange} />
      {importDialog}
    </div>
  );
}
