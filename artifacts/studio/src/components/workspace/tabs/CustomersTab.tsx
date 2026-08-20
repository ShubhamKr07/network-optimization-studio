import { useState } from "react";
import type { Customer, Scenario } from "@workspace/api-client-react";
import { CustomerTable, type CustomerOverride } from "@/components/tables/CustomerTable";
import { ImportDialog } from "@/components/ImportDialog";
import { Button } from "@/components/ui/button";
import { Download, Upload } from "lucide-react";
import { downloadEntityExport } from "@/lib/exportEntity";

interface CustomersTabProps {
  customers: Customer[];
  overrides: CustomerOverride[];
  onChange: (next: CustomerOverride[]) => void;
  /** Undefined while the scenario hasn't resolved yet — Upload/Download stay disabled until it has. */
  scenarioId?: number;
  /** Fired after a successful import apply, with the updated scenario — the caller (Workspace.tsx) refreshes its inputs draft from it. */
  onImportApplied?: (scenario: Scenario) => void;
}

// A1.1 — thin Workspace-tab wrapper around the existing CustomerTable (built
// for Studio.tsx's Overrides dialog, D3.1). Re-homed as-is, no fork.
//
// A1.3 — Upload/Download toolbar, wired to the existing ImportDialog
// (preview -> apply flow, reused as-is) and the existing exportScenario
// fetch function (via lib/exportEntity's shared download helper) — same
// components/flow Studio.tsx already uses, replicated here rather than
// rebuilt.
export function CustomersTab({ customers, overrides, onChange, scenarioId, onImportApplied }: CustomersTabProps) {
  const [importOpen, setImportOpen] = useState(false);

  const toolbar = (
    <div className="flex items-center gap-1.5 mb-2" data-testid="customers-tab-toolbar">
      <Button
        variant="outline"
        size="sm"
        onClick={() => scenarioId != null && downloadEntityExport(scenarioId, "customers", "csv")}
        disabled={scenarioId == null}
        data-testid="button-export-customers-csv"
        className="h-7 text-xs"
      >
        <Download className="w-3.5 h-3.5 mr-1" /> CSV
      </Button>
      <Button
        variant="outline"
        size="sm"
        onClick={() => scenarioId != null && downloadEntityExport(scenarioId, "customers", "json")}
        disabled={scenarioId == null}
        data-testid="button-export-customers-json"
        className="h-7 text-xs"
      >
        <Download className="w-3.5 h-3.5 mr-1" /> JSON
      </Button>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setImportOpen(true)}
        disabled={scenarioId == null}
        data-testid="button-import-customers"
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
      entity="customers"
      onApplied={onImportApplied}
    />
  );

  if (customers.length === 0) {
    return (
      <div>
        {toolbar}
        <p className="text-sm text-muted-foreground" data-testid="customers-tab-empty">
          No customers in this dataset.
        </p>
        {importDialog}
      </div>
    );
  }

  return (
    <div data-testid="customers-tab">
      {toolbar}
      <CustomerTable customers={customers} overrides={overrides} onChange={onChange} />
      {importDialog}
    </div>
  );
}
