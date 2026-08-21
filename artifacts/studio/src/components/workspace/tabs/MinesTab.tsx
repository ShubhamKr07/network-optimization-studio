import { useState } from "react";
import type { Scenario } from "@workspace/api-client-react";
import { MineTable, type MineOverride } from "@/components/tables/MineTable";
import { ImportDialog } from "@/components/ImportDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { AlertTriangle, Download, Upload, X } from "lucide-react";
import { downloadEntityExport } from "@/lib/exportEntity";
import {
  completenessCountForMine,
  idCollisionMessageForMine,
  type PrecheckErrorLike,
} from "@/lib/precheckDisplay";

interface MineRow { id: string; city: string; state: string; }

// Task 30 (B6.1 stage 4) — matches `addedMineSchema` in
// artifacts/api-server/src/validation/inputs/transportLp.ts exactly. No
// `status` field: mines have no forced-open/inactive concept anywhere in
// this LP (stage 1-3's own report, confirmed against solve_transport and
// mines.json) — a "closed" mine is a capacity override of 0, same precedent
// templates.ts's MineOverride comment already documents. `capacity` stays
// nullable/optional — a blank capacity on an added mine is a deliberate,
// valid "unconstrained" state (matches solve.py's get_base_capacity
// None-means-unconstrained convention), NOT a required field.
export interface AddedMine {
  id: string;
  city: string;
  state: string;
  lat: number;
  lng: number;
  capacity?: number | null;
}

interface MinesTabProps {
  mines: MineRow[];
  overrides: MineOverride[];
  onChange: (next: MineOverride[]) => void;
  /** Undefined while the scenario hasn't resolved yet — Upload/Download stay disabled until it has. */
  scenarioId?: number;
  /** Fired after a successful import apply, with the updated scenario — the caller (Workspace.tsx) refreshes its inputs draft from it. */
  onImportApplied?: (scenario: Scenario) => void;
  /** Task 30 — scenario-local addedMines. Fired on both add (append) and in-row capacity edits — full replacement array, same `onChange`-out convention as every other tab. */
  addedMines?: AddedMine[];
  onAddedMinesChange?: (next: AddedMine[]) => void;
  /** Fired on delete only — kept separate from onAddedMinesChange because the caller (Workspace.tsx) also needs to purge any laneCostOverrides referencing this id in the SAME atomic inputs update, same pattern B5.2 established for warehouses/customers + distanceOverrides. */
  onDeleteMine?: (id: string) => void;
  /** B6.1 stage 3's precheck errors for the current scenario — drives the inline "missing N lane costs" chip on added rows. Undefined/omitted degrades to "no warnings shown", never a crash. */
  precheckErrors?: PrecheckErrorLike[];
}

// A5.1 — transport-coal's Mines input tab. Same shape as WarehousesTab/
// CustomersTab (A1.1/A1.3): a thin wrapper around the existing MineTable
// (built for Studio.tsx's Overrides dialog) plus an Upload/Download toolbar
// wired to entity="mines" — the backend's import/export routes already
// accept it (routes/scenarios.ts), this is purely the frontend registration
// closing model-integration-precheck.md's Gate 1.9 gap for this model.
//
// Task 30 (B6.1 stage 4) — gains an "Added mines" section (add-row form +
// delete/precheck per row), mirroring WarehousesTab.tsx's own addedSection.
// Gated on `onAddedMinesChange != null` (not an unconditional render), same
// defensive pattern CustomersTab's own review fix established — MinesTab is
// verified transport-coal-only (single Workspace.tsx call site, confirmed
// directly rather than assumed) so there's no known cross-model leak risk
// today, but this costs nothing and matches the established convention.
export function MinesTab({
  mines,
  overrides,
  onChange,
  scenarioId,
  onImportApplied,
  addedMines = [],
  onAddedMinesChange,
  onDeleteMine,
  precheckErrors = [],
}: MinesTabProps) {
  const [importOpen, setImportOpen] = useState(false);

  // B5.2-mirrored add-row form draft state.
  const [addingRow, setAddingRow] = useState(false);
  const [newId, setNewId] = useState("");
  const [newCity, setNewCity] = useState("");
  const [newState, setNewState] = useState("");
  const [newLat, setNewLat] = useState("");
  const [newLng, setNewLng] = useState("");
  const [newCapacity, setNewCapacity] = useState("");
  const [addError, setAddError] = useState<string | null>(null);

  const knownMineIds = new Set([...mines.map(m => m.id), ...addedMines.map(m => m.id)]);

  function upsertAdded(id: string, patch: Partial<AddedMine>) {
    if (!onAddedMinesChange) return;
    onAddedMinesChange(addedMines.map(m => (m.id === id ? { ...m, ...patch } : m)));
  }

  function resetAddForm() {
    setAddingRow(false);
    setNewId("");
    setNewCity("");
    setNewState("");
    setNewLat("");
    setNewLng("");
    setNewCapacity("");
    setAddError(null);
  }

  function handleAddRow() {
    const id = newId.trim();
    const city = newCity.trim();
    const state = newState.trim();
    const lat = parseFloat(newLat);
    const lng = parseFloat(newLng);

    if (!id || !city || !state) {
      setAddError("ID, city, and state are all required.");
      return;
    }
    if (knownMineIds.has(id)) {
      setAddError(`ID '${id}' is already in use by another mine in this scenario.`);
      return;
    }
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      setAddError("Latitude and longitude must both be numbers.");
      return;
    }
    // Capacity is deliberately optional here — a blank value means
    // unconstrained (see the AddedMine type's own header comment), not an
    // error, matching solve.py's get_base_capacity convention.
    let capacity: number | null = null;
    if (newCapacity.trim() !== "") {
      const parsed = parseFloat(newCapacity);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        setAddError("Capacity must be a positive number, or left blank for unconstrained.");
        return;
      }
      capacity = parsed;
    }

    onAddedMinesChange?.([...addedMines, { id, city, state, lat, lng, capacity }]);
    resetAddForm();
  }

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

  // Task 30 — the "Added mines" section. Base dataset rows (MineTable, above)
  // keep their existing capacity-override-only affordance untouched; only
  // entries actually present in addedMines ever get a delete button. No
  // status column at all — mines have no status concept (see the AddedMine
  // type's header comment).
  const addedSection = onAddedMinesChange != null && (
    <div className="mt-4" data-testid="added-mines-section">
      <h3 className="text-xs font-semibold text-muted-foreground mb-1.5">Added mines</h3>
      {addedMines.length === 0 ? (
        <p className="text-xs text-muted-foreground mb-2" data-testid="added-mines-empty">
          No added mines yet — use "+ Add mine" below to create one.
        </p>
      ) : (
        <div className="max-h-[40vh] overflow-y-auto mb-2">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>ID</TableHead>
                <TableHead>City, State</TableHead>
                <TableHead>Capacity</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {addedMines.map(m => {
                const missing = completenessCountForMine(precheckErrors, m.id);
                const collision = idCollisionMessageForMine(precheckErrors, m.id);
                return (
                  <TableRow key={m.id} data-testid={`row-added-mine-${m.id}`}>
                    <TableCell className="font-mono text-xs">
                      <div className="flex items-center gap-1">
                        {m.id}
                        {(missing != null || collision) && (
                          <span
                            title={collision ?? `Missing lane costs to ${missing} station${missing === 1 ? "" : "s"} — see the Lane costs tab, or download/upload a template.`}
                            data-testid={`warning-precheck-added-mine-${m.id}`}
                            className="inline-flex items-center gap-0.5 text-[10px] text-amber-700 bg-amber-100 border border-amber-300 rounded px-1"
                          >
                            <AlertTriangle className="w-3 h-3" />
                            {collision ? "ID collision" : `Missing ${missing} lane cost${missing === 1 ? "" : "s"}`}
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-xs">{m.city}, {m.state}</TableCell>
                    <TableCell>
                      <Input
                        type="number"
                        min={0}
                        value={m.capacity ?? ""}
                        onChange={e => {
                          const raw = e.target.value;
                          upsertAdded(m.id, { capacity: raw === "" ? null : Math.max(0, parseFloat(raw) || 0) });
                        }}
                        className="h-7 text-xs w-28"
                        placeholder="unconstrained"
                        data-testid={`input-added-mine-capacity-${m.id}`}
                      />
                    </TableCell>
                    <TableCell>
                      <button
                        type="button"
                        aria-label={`Delete added mine ${m.id}`}
                        onClick={() => onDeleteMine?.(m.id)}
                        data-testid={`button-delete-added-mine-${m.id}`}
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
        <div className="flex items-start gap-1.5 flex-wrap" data-testid="add-mine-row-form">
          <Input placeholder="ID" value={newId} onChange={e => setNewId(e.target.value)} className="h-7 text-xs w-24" data-testid="input-new-mine-id" />
          <Input placeholder="City" value={newCity} onChange={e => setNewCity(e.target.value)} className="h-7 text-xs w-28" data-testid="input-new-mine-city" />
          <Input placeholder="State" value={newState} onChange={e => setNewState(e.target.value)} className="h-7 text-xs w-16" data-testid="input-new-mine-state" />
          <Input type="number" placeholder="Lat" value={newLat} onChange={e => setNewLat(e.target.value)} className="h-7 text-xs w-20" data-testid="input-new-mine-lat" />
          <Input type="number" placeholder="Lng" value={newLng} onChange={e => setNewLng(e.target.value)} className="h-7 text-xs w-20" data-testid="input-new-mine-lng" />
          <Input type="number" placeholder="Capacity (optional)" value={newCapacity} onChange={e => setNewCapacity(e.target.value)} className="h-7 text-xs w-32" data-testid="input-new-mine-capacity" />
          <Button size="sm" className="h-7 px-2 text-xs" onClick={handleAddRow} data-testid="button-add-mine-confirm">
            Add
          </Button>
          <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={resetAddForm} data-testid="button-add-mine-cancel">
            Cancel
          </Button>
        </div>
      ) : (
        <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => setAddingRow(true)} data-testid="button-add-mine-row">
          + Add mine
        </Button>
      )}
      {addError && (
        <p className="text-[11px] text-destructive mt-1" data-testid="text-add-mine-error">
          {addError}
        </p>
      )}
    </div>
  );

  if (mines.length === 0) {
    return (
      <div>
        {toolbar}
        <p className="text-sm text-muted-foreground" data-testid="mines-tab-empty">
          No mines in this dataset.
        </p>
        {addedSection}
        {importDialog}
      </div>
    );
  }

  return (
    <div data-testid="mines-tab">
      {toolbar}
      <MineTable mines={mines} overrides={overrides} onChange={onChange} />
      {addedSection}
      {importDialog}
    </div>
  );
}
