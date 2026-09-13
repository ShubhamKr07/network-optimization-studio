import { useEffect, useState } from "react";
import type { Plant, Scenario } from "@workspace/api-client-react";
import { ImportDialog } from "@/components/ImportDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Download, Upload, X } from "lucide-react";
import { downloadEntityExport } from "@/lib/exportEntity";
import { lookupCity } from "@/lib/gazetteer";
import { cityCode } from "@/lib/entityId";

// T11 (Chapter 9 JADE) — a plant's uid prefix + display-code minting is
// deliberately NOT threaded through `lib/entityId.ts`'s shared
// `UID_PREFIX`/`DISPLAY_CODE_PREFIX` maps here: that consolidation is T12's
// job (plan's Wave 3 file list — "lib/entityId.ts — plant UID prefix
// (`ap-…`) in `newUid` and `nextDisplayCode`"), and T11/T12 are executed as
// separate, potentially concurrent leaves-first tasks per the plan's
// concurrency map. Minting the same-shaped id/display-code locally here
// avoids a merge collision on that shared file while still matching the
// eventual convention exactly (`ap-<uuid>` / `PL-STATE-CITY-SEQ`) — `T12`
// folding this into the shared module is a pure refactor, not a behavior
// change, once it lands.
function newPlantUid(): string {
  const uuid =
    globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
  return `ap-${uuid}`;
}

function nextPlantDisplayCode(state: string, city: string, existingCodes: Iterable<string>): string {
  const taken = new Set(existingCodes);
  const base = `PL-${state}-${cityCode(city)}`;
  let seq = 1;
  let candidate = `${base}-${String(seq).padStart(2, "0")}`;
  while (taken.has(candidate)) {
    seq += 1;
    candidate = `${base}-${String(seq).padStart(2, "0")}`;
  }
  return candidate;
}

// T11 — matches `jadeInputsSchema`'s `addedPlants[]` shape exactly
// (`{ id, displayCode?, city, state, lat, lng }`, spec §5): geometry only.
// A plant has no status and no capacity of its own — every bit of its
// editable behavior (which product(s) it can make) lives in the Capability
// Matrix tab (T11's `CapabilityMatrixTab`), driven by `plantProductCapability`
// overrides keyed by this same `id`.
export interface AddedPlant {
  id: string;
  city: string;
  state: string;
  lat: number;
  lng: number;
  displayCode?: string;
}

interface PlantsTabProps {
  /** Base dataset plants (Chapter 9 JADE only — `Dataset.plants`, absent for
   * every other model). Read-only: id/city/state/lat/lng, no status/capacity
   * column at all (spec §6 — "id, city/state, lat/lon (read-only base +
   * added rows)"). */
  plants: Plant[];
  /** Undefined while the scenario hasn't resolved yet — Upload/Download stay disabled until it has. */
  scenarioId?: number;
  /** Fired after a successful import apply, with the updated scenario — the caller (Workspace.tsx) refreshes its inputs draft from it. */
  onImportApplied?: (scenario: Scenario) => void;
  /** Scenario-local addedPlants. Fired on both add (append) and in-row edits
   * — full replacement array, same `onChange`-out convention as every other
   * tab. Gates the "Added plants" section's render (capability-based, not
   * `modelId ===` — Gate 6/1.9). */
  addedPlants?: AddedPlant[];
  onAddedPlantsChange?: (next: AddedPlant[]) => void;
  /** Fired on delete only — kept separate from onAddedPlantsChange because
   * the caller (Workspace.tsx) also needs to purge any
   * `plantProductCapability` overrides AND plant→warehouse
   * `distanceOverrides` referencing this id in the SAME atomic inputs
   * update (spec §6's plant delete/copy reconciliation — T12's job to wire,
   * this tab only fires the intent). */
  onDeletePlant?: (id: string) => void;
  /** Phase 3.2, Task 4 pattern — set by Workspace.tsx after an Input Map
   * Confirm click. When non-null, opens the add-row form and pre-fills
   * newLat/newLng, then calls onPrefillConsumed so Workspace.tsx clears it
   * (one-shot, not a controlled value). */
  prefillCoords?: { lat: number; lng: number } | null;
  onPrefillConsumed?: () => void;
}

// T11 — Chapter 9 JADE's Plants input tab. Same shape as WarehousesTab/
// CustomersTab/MinesTab (A1.1/A1.3/A5.1): a thin read-only base table plus
// an Upload/Download toolbar (backend registration is T7's job — this is
// purely the frontend half of Gate 1.9) and an "Added plants" add/delete-row
// section (B5.2/Task-30-style UX), gated on `onAddedPlantsChange != null`
// (capability-based, matching WarehousesTab/CustomersTab/MinesTab's own
// established fix for the "gate on one branch, forget the sibling"
// recurring bug class).
export function PlantsTab({
  plants,
  scenarioId,
  onImportApplied,
  addedPlants = [],
  onAddedPlantsChange,
  onDeletePlant,
  prefillCoords,
  onPrefillConsumed,
}: PlantsTabProps) {
  const [importOpen, setImportOpen] = useState(false);

  const [addingRow, setAddingRow] = useState(false);
  const [newCity, setNewCity] = useState("");
  const [newState, setNewState] = useState("");
  const [newLat, setNewLat] = useState("");
  const [newLng, setNewLng] = useState("");
  const [newDisplayCode, setNewDisplayCode] = useState("");
  const [addError, setAddError] = useState<string | null>(null);

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
      const existingCodes = addedPlants.map(p => p.displayCode).filter((c): c is string => !!c);
      setNewDisplayCode(nextPlantDisplayCode(state, city, existingCodes));
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

  function resetAddForm() {
    setAddingRow(false);
    setNewCity("");
    setNewState("");
    setNewLat("");
    setNewLng("");
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
    const displayCode = newDisplayCode.trim() || undefined;
    if (displayCode && addedPlants.some(p => p.displayCode === displayCode)) {
      setAddError(`Display code '${displayCode}' is already in use by another plant in this scenario.`);
      return;
    }
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      setAddError("Latitude and longitude must both be numbers.");
      return;
    }

    const id = newPlantUid();
    onAddedPlantsChange?.([...addedPlants, { id, city, state, lat, lng, displayCode }]);
    resetAddForm();
  }

  const toolbar = (
    <div className="flex items-center gap-1.5 mb-2" data-testid="plants-tab-toolbar">
      <Button
        variant="outline"
        size="sm"
        onClick={() => scenarioId != null && downloadEntityExport(scenarioId, "plants", "csv")}
        disabled={scenarioId == null}
        data-testid="button-export-plants-csv"
        className="h-7 text-xs"
      >
        <Download className="w-3.5 h-3.5 mr-1" /> CSV
      </Button>
      <Button
        variant="outline"
        size="sm"
        onClick={() => scenarioId != null && downloadEntityExport(scenarioId, "plants", "json")}
        disabled={scenarioId == null}
        data-testid="button-export-plants-json"
        className="h-7 text-xs"
      >
        <Download className="w-3.5 h-3.5 mr-1" /> JSON
      </Button>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setImportOpen(true)}
        disabled={scenarioId == null}
        data-testid="button-import-plants"
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
      entity="plants"
      onApplied={onImportApplied}
    />
  );

  // The "Added plants" section — no status/capacity column at all (a plant
  // has neither concept; see the AddedPlant type's header comment).
  const addedSection = onAddedPlantsChange != null && (
    <div className="mt-4" data-testid="added-plants-section">
      <h3 className="text-xs font-semibold text-muted-foreground mb-1.5">Added plants</h3>
      {addedPlants.length === 0 ? (
        <p className="text-xs text-muted-foreground mb-2" data-testid="added-plants-empty">
          No added plants yet — use "+ Add plant" below to create one.
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
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {addedPlants.map(p => (
                <TableRow key={p.id} data-testid={`row-added-plant-${p.id}`}>
                  <TableCell className="font-mono text-xs">{p.displayCode ?? p.id}</TableCell>
                  <TableCell className="text-xs">{p.city}</TableCell>
                  <TableCell className="text-xs">{p.state}</TableCell>
                  <TableCell className="text-xs font-mono">{p.lat.toFixed(4)}</TableCell>
                  <TableCell className="text-xs font-mono">{p.lng.toFixed(4)}</TableCell>
                  <TableCell>
                    <button
                      type="button"
                      aria-label={`Delete added plant ${p.id}`}
                      onClick={() => onDeletePlant?.(p.id)}
                      data-testid={`button-delete-added-plant-${p.id}`}
                      className="text-muted-foreground hover:text-destructive"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {addingRow ? (
        <div className="flex items-start gap-1.5 flex-wrap" data-testid="add-plant-row-form">
          <Input
            placeholder="City"
            value={newCity}
            onChange={e => setNewCity(e.target.value)}
            onBlur={handleCityStateBlur}
            className="h-7 text-xs w-28"
            data-testid="input-new-plant-city"
          />
          <Input
            placeholder="State"
            value={newState}
            onChange={e => setNewState(e.target.value)}
            onBlur={handleCityStateBlur}
            className="h-7 text-xs w-16"
            data-testid="input-new-plant-state"
          />
          <Input
            type="number"
            placeholder="Lat"
            value={newLat}
            onChange={e => setNewLat(e.target.value)}
            onFocus={touchLat}
            className={`h-7 text-xs w-20 font-mono ${!latTouched && newLat ? "bg-muted text-muted-foreground" : ""}`}
            data-testid="input-new-plant-lat"
          />
          <Input
            type="number"
            placeholder="Lng"
            value={newLng}
            onChange={e => setNewLng(e.target.value)}
            onFocus={touchLng}
            className={`h-7 text-xs w-20 font-mono ${!lngTouched && newLng ? "bg-muted text-muted-foreground" : ""}`}
            data-testid="input-new-plant-lng"
          />
          <Input
            placeholder="Display code (auto)"
            value={newDisplayCode}
            onChange={e => setNewDisplayCode(e.target.value)}
            onFocus={touchDisplayCode}
            className={`h-7 text-xs w-32 ${!displayCodeTouched && newDisplayCode ? "bg-muted text-muted-foreground" : ""}`}
            data-testid="input-new-plant-display-code"
          />
          <Button size="sm" className="h-7 px-2 text-xs" onClick={handleAddRow} data-testid="button-add-plant-confirm">
            Add
          </Button>
          <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={resetAddForm} data-testid="button-add-plant-cancel">
            Cancel
          </Button>
        </div>
      ) : (
        <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => setAddingRow(true)} data-testid="button-add-plant-row">
          + Add plant
        </Button>
      )}
      {addError && (
        <p className="text-[11px] text-destructive mt-1" data-testid="text-add-plant-error">
          {addError}
        </p>
      )}
    </div>
  );

  if (plants.length === 0) {
    return (
      <div>
        {toolbar}
        <p className="text-sm text-muted-foreground" data-testid="plants-tab-empty">
          No plants in this dataset.
        </p>
        {addedSection}
        {importDialog}
      </div>
    );
  }

  return (
    <div data-testid="plants-tab">
      {toolbar}
      <div className="max-h-[60vh] overflow-y-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>ID</TableHead>
              <TableHead>City</TableHead>
              <TableHead>State</TableHead>
              <TableHead>Latitude</TableHead>
              <TableHead>Longitude</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {plants.map(p => (
              <TableRow key={p.id}>
                <TableCell className="font-mono text-xs">{p.name ?? p.id}</TableCell>
                <TableCell className="text-xs">{p.city}</TableCell>
                <TableCell className="text-xs">{p.state}</TableCell>
                <TableCell className="text-xs font-mono">{p.lat.toFixed(4)}</TableCell>
                <TableCell className="text-xs font-mono">{p.lng.toFixed(4)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {addedSection}
      {importDialog}
    </div>
  );
}
