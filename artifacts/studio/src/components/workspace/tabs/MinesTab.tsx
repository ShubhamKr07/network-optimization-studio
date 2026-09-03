import { useEffect, useState } from "react";
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
import { lookupCity } from "@/lib/gazetteer";
import { newUid, nextDisplayCode } from "@/lib/entityId";

interface MineRow { id: string; city: string; state: string; lat: number; lng: number; zip?: string; }

// Task 30 (B6.1 stage 4) — matches `addedMineSchema` in
// artifacts/api-server/src/validation/inputs/transportLp.ts exactly. No
// `status` field: mines have no forced-open/inactive concept anywhere in
// this LP (stage 1-3's own report, confirmed against solve_transport and
// mines.json) — a "closed" mine is a capacity override of 0, same precedent
// templates.ts's MineOverride comment already documents. `capacity` stays
// nullable/optional — a blank capacity on an added mine is a deliberate,
// valid "unconstrained" state (matches solve.py's get_base_capacity
// None-means-unconstrained convention), NOT a required field.
// T11 (Input Map v2 identity model, Step A) — `id` is now a hidden T3
// stable uid (`am-<uuid>`, minted via `newUid("mn")`), never typed;
// `displayCode` is the human-facing, collision-checked label, matching
// WarehousesTab.tsx's own T9 migration exactly.
export interface AddedMine {
  id: string;
  city: string;
  state: string;
  lat: number;
  lng: number;
  capacity?: number | null;
  displayCode?: string;
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
  /** Phase 3.2, Task 4 — set by Workspace.tsx after an Input Map Confirm click. When non-null, opens the add-row form and pre-fills newLat/newLng, then calls onPrefillConsumed so Workspace.tsx clears it (one-shot, not a controlled value). */
  prefillCoords?: { lat: number; lng: number } | null;
  onPrefillConsumed?: () => void;
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
  prefillCoords,
  onPrefillConsumed,
}: MinesTabProps) {
  const [importOpen, setImportOpen] = useState(false);

  // B5.2-mirrored add-row form draft state.
  const [addingRow, setAddingRow] = useState(false);
  const [newCity, setNewCity] = useState("");
  const [newState, setNewState] = useState("");
  const [newLat, setNewLat] = useState("");
  const [newLng, setNewLng] = useState("");
  const [newCapacity, setNewCapacity] = useState("");
  const [newDisplayCode, setNewDisplayCode] = useState("");
  const [addError, setAddError] = useState<string | null>(null);

  // T11 (Step A) — grid-mirror, mirroring WarehousesTab.tsx's own T9
  // migration exactly: `id` is a hidden T3 stable uid minted at commit time
  // (never typed, never shown), `displayCode` (T3's nextDisplayCode) is the
  // human-facing label auto-filled from City/State via T2's gazetteer, same
  // "touched" tracking as WarehousesTab. There is no more manual "ID" input
  // or id-collision check — a random uid can't meaningfully collide.
  const [latTouched, setLatTouched] = useState(false);
  const [lngTouched, setLngTouched] = useState(false);
  const [displayCodeTouched, setDisplayCodeTouched] = useState(false);

  function touchLat() {
    if (!latTouched) {
      setLatTouched(true);
      setNewLat("");
    }
  }
  function touchLng() {
    if (!lngTouched) {
      setLngTouched(true);
      setNewLng("");
    }
  }
  function touchDisplayCode() {
    if (!displayCodeTouched) {
      setDisplayCodeTouched(true);
      setNewDisplayCode("");
    }
  }

  function handleCityStateBlur() {
    const city = newCity.trim();
    const state = newState.trim();
    if (!city || !state) return;
    const hit = lookupCity(city, state);
    if (!hit) return;
    if (!latTouched) setNewLat(String(hit.lat));
    if (!lngTouched) setNewLng(String(hit.lng));
    if (!displayCodeTouched) {
      const existingCodes = addedMines.map(m => m.displayCode).filter((c): c is string => !!c);
      setNewDisplayCode(nextDisplayCode("mn", state, city, existingCodes));
    }
  }

  // Phase 3.2, Task 4 — Input Map click-to-place prefill (see WarehousesTab's own comment on this same pattern).
  useEffect(() => {
    if (!prefillCoords) return;
    setAddingRow(true);
    setNewLat(String(prefillCoords.lat));
    setNewLng(String(prefillCoords.lng));
    onPrefillConsumed?.();
  }, [prefillCoords, onPrefillConsumed]);

  function upsertAdded(id: string, patch: Partial<AddedMine>) {
    if (!onAddedMinesChange) return;
    onAddedMinesChange(addedMines.map(m => (m.id === id ? { ...m, ...patch } : m)));
  }

  function resetAddForm() {
    setAddingRow(false);
    setNewCity("");
    setNewState("");
    setNewLat("");
    setNewLng("");
    setNewCapacity("");
    setNewDisplayCode("");
    setLatTouched(false);
    setLngTouched(false);
    setDisplayCodeTouched(false);
    setAddError(null);
  }

  function handleAddRow() {
    const city = newCity.trim();
    const state = newState.trim();
    const lat = parseFloat(newLat);
    const lng = parseFloat(newLng);

    if (!city || !state) {
      setAddError("City and state are both required.");
      return;
    }
    // T11 (Step A) — displayCode is now the user-facing, collision-checked
    // field (the old "ID" input's role), since `id` is a hidden uid that
    // can't meaningfully collide. Mirrors WarehousesTab's own T9 comment
    // exactly.
    const displayCode = newDisplayCode.trim() || undefined;
    if (displayCode && addedMines.some(m => m.displayCode === displayCode)) {
      setAddError(`Display code '${displayCode}' is already in use by another mine in this scenario.`);
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

    const id = newUid("mn");
    onAddedMinesChange?.([...addedMines, { id, city, state, lat, lng, capacity, displayCode }]);
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
                <TableHead>City</TableHead>
                <TableHead>State</TableHead>
                <TableHead>Latitude</TableHead>
                <TableHead>Longitude</TableHead>
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
                        {/* T11 (Step A) — `id` is now a hidden T3 stable uid
                          * (see the grid-mirror comment above);
                          * `displayCode` is the human-facing label. Falls
                          * back to `id` only for pre-Step-A data that never
                          * got one. */}
                        {m.displayCode ?? m.id}
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
                    <TableCell className="text-xs">{m.city}</TableCell>
                    <TableCell className="text-xs">{m.state}</TableCell>
                    <TableCell className="text-xs font-mono">{m.lat.toFixed(4)}</TableCell>
                    <TableCell className="text-xs font-mono">{m.lng.toFixed(4)}</TableCell>
                    <TableCell>
                      <Input
                        type="number"
                        min={0}
                        value={m.capacity ?? ""}
                        onChange={e => {
                          const raw = e.target.value;
                          upsertAdded(m.id, { capacity: raw === "" ? null : Math.max(0, parseFloat(raw) || 0) });
                        }}
                        className="h-7 text-xs w-28 font-mono"
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
          <Input
            placeholder="City"
            value={newCity}
            onChange={e => setNewCity(e.target.value)}
            onBlur={handleCityStateBlur}
            className="h-7 text-xs w-28"
            data-testid="input-new-mine-city"
          />
          <Input
            placeholder="State"
            value={newState}
            onChange={e => setNewState(e.target.value)}
            onBlur={handleCityStateBlur}
            className="h-7 text-xs w-16"
            data-testid="input-new-mine-state"
          />
          <Input
            type="number"
            placeholder="Lat"
            value={newLat}
            onChange={e => setNewLat(e.target.value)}
            onFocus={touchLat}
            className={`h-7 text-xs w-20 font-mono ${!latTouched && newLat ? "bg-muted text-muted-foreground" : ""}`}
            data-testid="input-new-mine-lat"
          />
          <Input
            type="number"
            placeholder="Lng"
            value={newLng}
            onChange={e => setNewLng(e.target.value)}
            onFocus={touchLng}
            className={`h-7 text-xs w-20 font-mono ${!lngTouched && newLng ? "bg-muted text-muted-foreground" : ""}`}
            data-testid="input-new-mine-lng"
          />
          <Input
            placeholder="Display code (auto)"
            value={newDisplayCode}
            onChange={e => setNewDisplayCode(e.target.value)}
            onFocus={touchDisplayCode}
            className={`h-7 text-xs w-32 ${!displayCodeTouched && newDisplayCode ? "bg-muted text-muted-foreground" : ""}`}
            data-testid="input-new-mine-display-code"
          />
          <Input type="number" placeholder="Capacity (optional)" value={newCapacity} onChange={e => setNewCapacity(e.target.value)} className="h-7 text-xs w-32 font-mono" data-testid="input-new-mine-capacity" />
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
