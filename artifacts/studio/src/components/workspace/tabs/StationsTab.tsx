import { useEffect, useState } from "react";
import type { Scenario } from "@workspace/api-client-react";
import { StationTable, type StationOverride } from "@/components/tables/StationTable";
import { ImportDialog } from "@/components/ImportDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { AlertTriangle, Download, Upload, X } from "lucide-react";
import { downloadEntityExport } from "@/lib/exportEntity";
import {
  completenessCountForStation,
  idCollisionMessageForStation,
  type PrecheckErrorLike,
} from "@/lib/precheckDisplay";

interface StationRow { id: string; city: string; state: string; lat: number; lng: number; zip?: string; }

// Task 30 (B6.1 stage 4) — matches `addedStationSchema` in
// artifacts/api-server/src/validation/inputs/transportLp.ts exactly. `demand`
// is required (non-nullable), unlike AddedMine's optional capacity — a
// brand-new station can't be added with no demand at all, same rule
// addedCustomerSchema already enforces for customers.
export interface AddedStation {
  id: string;
  city: string;
  state: string;
  lat: number;
  lng: number;
  demand: number;
}

interface StationsTabProps {
  stations: StationRow[];
  overrides: StationOverride[];
  onChange: (next: StationOverride[]) => void;
  /** Undefined while the scenario hasn't resolved yet — Upload/Download stay disabled until it has. */
  scenarioId?: number;
  /** Fired after a successful import apply, with the updated scenario — the caller (Workspace.tsx) refreshes its inputs draft from it. */
  onImportApplied?: (scenario: Scenario) => void;
  /** Task 30 — scenario-local addedStations. Fired on both add (append) and in-row demand edits — full replacement array, same `onChange`-out convention as every other tab. */
  addedStations?: AddedStation[];
  onAddedStationsChange?: (next: AddedStation[]) => void;
  /** Fired on delete only — kept separate from onAddedStationsChange because the caller (Workspace.tsx) also needs to purge any laneCostOverrides referencing this id in the SAME atomic inputs update, same pattern B5.2 established for warehouses/customers + distanceOverrides. */
  onDeleteStation?: (id: string) => void;
  /** B6.1 stage 3's precheck errors for the current scenario — drives the inline "N mines lack a lane cost" chip on added rows. Undefined/omitted degrades to "no warnings shown", never a crash. */
  precheckErrors?: PrecheckErrorLike[];
  /** Phase 3.2, Task 4 — set by Workspace.tsx after an Input Map Confirm click. When non-null, opens the add-row form and pre-fills newLat/newLng, then calls onPrefillConsumed so Workspace.tsx clears it (one-shot, not a controlled value). */
  prefillCoords?: { lat: number; lng: number } | null;
  onPrefillConsumed?: () => void;
}

// A5.1 — transport-coal's Stations input tab. Mirrors MinesTab (same file
// shape as WarehousesTab/CustomersTab) — a thin wrapper around the existing
// StationTable plus an Upload/Download toolbar wired to entity="stations".
//
// Task 30 (B6.1 stage 4) — gains an "Added stations" section (add-row form +
// delete/precheck per row), mirroring CustomersTab.tsx's own addedSection
// (demand required, no status column) rather than MinesTab's (capacity
// optional, no status column). Gated on `onAddedStationsChange != null`,
// same defensive convention CustomersTab's own review fix established —
// StationsTab is verified transport-coal-only (single Workspace.tsx call
// site) so there's no known cross-model leak risk today.
export function StationsTab({
  stations,
  overrides,
  onChange,
  scenarioId,
  onImportApplied,
  addedStations = [],
  onAddedStationsChange,
  onDeleteStation,
  precheckErrors = [],
  prefillCoords,
  onPrefillConsumed,
}: StationsTabProps) {
  const [importOpen, setImportOpen] = useState(false);

  const [addingRow, setAddingRow] = useState(false);
  const [newId, setNewId] = useState("");
  const [newCity, setNewCity] = useState("");
  const [newState, setNewState] = useState("");
  const [newLat, setNewLat] = useState("");
  const [newLng, setNewLng] = useState("");
  const [newDemand, setNewDemand] = useState("");
  const [addError, setAddError] = useState<string | null>(null);

  // Phase 3.2, Task 4 — Input Map click-to-place prefill (see WarehousesTab's own comment on this same pattern).
  useEffect(() => {
    if (!prefillCoords) return;
    setAddingRow(true);
    setNewLat(String(prefillCoords.lat));
    setNewLng(String(prefillCoords.lng));
    onPrefillConsumed?.();
  }, [prefillCoords, onPrefillConsumed]);

  const knownStationIds = new Set([...stations.map(s => s.id), ...addedStations.map(s => s.id)]);

  function upsertAddedDemand(id: string, demand: number) {
    onAddedStationsChange?.(addedStations.map(s => (s.id === id ? { ...s, demand } : s)));
  }

  function resetAddForm() {
    setAddingRow(false);
    setNewId("");
    setNewCity("");
    setNewState("");
    setNewLat("");
    setNewLng("");
    setNewDemand("");
    setAddError(null);
  }

  function handleAddRow() {
    const id = newId.trim();
    const city = newCity.trim();
    const state = newState.trim();
    const lat = parseFloat(newLat);
    const lng = parseFloat(newLng);
    const demand = parseFloat(newDemand);

    if (!id || !city || !state) {
      setAddError("ID, city, and state are all required.");
      return;
    }
    if (knownStationIds.has(id)) {
      setAddError(`ID '${id}' is already in use by another station in this scenario.`);
      return;
    }
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      setAddError("Latitude and longitude must both be numbers.");
      return;
    }
    if (!Number.isFinite(demand) || demand < 0) {
      setAddError("Demand must be a number ≥ 0.");
      return;
    }

    onAddedStationsChange?.([...addedStations, { id, city, state, lat, lng, demand }]);
    resetAddForm();
  }

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

  const addedSection = onAddedStationsChange != null && (
    <div className="mt-4" data-testid="added-stations-section">
      <h3 className="text-xs font-semibold text-muted-foreground mb-1.5">Added stations</h3>
      {addedStations.length === 0 ? (
        <p className="text-xs text-muted-foreground mb-2" data-testid="added-stations-empty">
          No added stations yet — use "+ Add station" below to create one.
        </p>
      ) : (
        <div className="max-h-[40vh] overflow-y-auto mb-2">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>ID</TableHead>
                <TableHead>City</TableHead>
                <TableHead>State</TableHead>
                <TableHead>Latitude</TableHead>
                <TableHead>Longitude</TableHead>
                <TableHead>Demand</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {addedStations.map(s => {
                const missing = completenessCountForStation(precheckErrors, s.id);
                const collision = idCollisionMessageForStation(precheckErrors, s.id);
                return (
                  <TableRow key={s.id} data-testid={`row-added-station-${s.id}`}>
                    <TableCell className="font-mono text-xs">
                      <div className="flex items-center gap-1">
                        {s.id}
                        {(missing > 0 || collision) && (
                          <span
                            title={collision ?? `${missing} mine${missing === 1 ? " lacks" : "s lack"} a lane cost to this station — see the Lane costs tab, or download/upload a template.`}
                            data-testid={`warning-precheck-added-station-${s.id}`}
                            className="inline-flex items-center gap-0.5 text-[10px] text-amber-700 bg-amber-100 border border-amber-300 rounded px-1"
                          >
                            <AlertTriangle className="w-3 h-3" />
                            {collision ? "ID collision" : `Missing ${missing} lane cost${missing === 1 ? "" : "s"}`}
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-xs">{s.city}</TableCell>
                    <TableCell className="text-xs">{s.state}</TableCell>
                    <TableCell className="text-xs font-mono">{s.lat.toFixed(4)}</TableCell>
                    <TableCell className="text-xs font-mono">{s.lng.toFixed(4)}</TableCell>
                    <TableCell>
                      <Input
                        type="number"
                        min={0}
                        value={s.demand}
                        onChange={e => {
                          const parsed = Number(e.target.value);
                          if (Number.isFinite(parsed) && parsed >= 0) upsertAddedDemand(s.id, parsed);
                        }}
                        className="h-7 text-xs w-28"
                        data-testid={`input-added-station-demand-${s.id}`}
                      />
                    </TableCell>
                    <TableCell>
                      <button
                        type="button"
                        aria-label={`Delete added station ${s.id}`}
                        onClick={() => onDeleteStation?.(s.id)}
                        data-testid={`button-delete-added-station-${s.id}`}
                        className="text-muted-foreground hover:text-destructive"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {addingRow ? (
        <div className="flex items-start gap-1.5 flex-wrap" data-testid="add-station-row-form">
          <Input placeholder="ID" value={newId} onChange={e => setNewId(e.target.value)} className="h-7 text-xs w-24" data-testid="input-new-station-id" />
          <Input placeholder="City" value={newCity} onChange={e => setNewCity(e.target.value)} className="h-7 text-xs w-28" data-testid="input-new-station-city" />
          <Input placeholder="State" value={newState} onChange={e => setNewState(e.target.value)} className="h-7 text-xs w-16" data-testid="input-new-station-state" />
          <Input type="number" placeholder="Lat" value={newLat} onChange={e => setNewLat(e.target.value)} className="h-7 text-xs w-20" data-testid="input-new-station-lat" />
          <Input type="number" placeholder="Lng" value={newLng} onChange={e => setNewLng(e.target.value)} className="h-7 text-xs w-20" data-testid="input-new-station-lng" />
          <Input type="number" placeholder="Demand" value={newDemand} onChange={e => setNewDemand(e.target.value)} className="h-7 text-xs w-24" data-testid="input-new-station-demand" />
          <Button size="sm" className="h-7 px-2 text-xs" onClick={handleAddRow} data-testid="button-add-station-confirm">
            Add
          </Button>
          <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={resetAddForm} data-testid="button-add-station-cancel">
            Cancel
          </Button>
        </div>
      ) : (
        <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => setAddingRow(true)} data-testid="button-add-station-row">
          + Add station
        </Button>
      )}
      {addError && (
        <p className="text-[11px] text-destructive mt-1" data-testid="text-add-station-error">
          {addError}
        </p>
      )}
    </div>
  );

  if (stations.length === 0) {
    return (
      <div>
        {toolbar}
        <p className="text-sm text-muted-foreground" data-testid="stations-tab-empty">
          No stations in this dataset.
        </p>
        {addedSection}
        {importDialog}
      </div>
    );
  }

  return (
    <div data-testid="stations-tab">
      {toolbar}
      <StationTable stations={stations} overrides={overrides} onChange={onChange} />
      {addedSection}
      {importDialog}
    </div>
  );
}
