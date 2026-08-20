import type { WarehouseCandidate } from "@workspace/api-client-react";
import { WarehouseTable, type WarehouseOverride } from "@/components/tables/WarehouseTable";

interface WarehousesTabProps {
  warehouses: WarehouseCandidate[];
  overrides: WarehouseOverride[];
  capacityMode: "none" | "uniform" | "per_wh";
  onChange: (next: WarehouseOverride[]) => void;
}

// A1.1 — thin Workspace-tab wrapper around the existing WarehouseTable
// (built for Studio.tsx's Overrides dialog, D2.1/D1.2). Re-homed as-is, no
// fork: WarehouseTable itself already speaks DD-6's UI vocabulary (its own
// STATUS_LABEL constant). The only behavior added here is the mine-candidate
// filter (mirrors Studio.tsx's `dataset.warehouses.filter(w => w.kind !==
// "mine")` — a mine is never a facility-location choice, so it doesn't
// belong in this table) and an empty-dataset fallback.
export function WarehousesTab({ warehouses, overrides, capacityMode, onChange }: WarehousesTabProps) {
  const candidates = warehouses.filter(w => w.kind !== "mine");

  if (candidates.length === 0) {
    return (
      <p className="text-sm text-muted-foreground" data-testid="warehouses-tab-empty">
        No warehouse candidates in this dataset.
      </p>
    );
  }

  return (
    <div data-testid="warehouses-tab">
      <WarehouseTable warehouses={candidates} overrides={overrides} capacityMode={capacityMode} onChange={onChange} />
    </div>
  );
}
