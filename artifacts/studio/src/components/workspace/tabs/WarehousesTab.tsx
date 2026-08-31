import { useEffect, useState } from "react";
import type { WarehouseCandidate, Scenario } from "@workspace/api-client-react";
import { WarehouseTable, type WarehouseOverride } from "@/components/tables/WarehouseTable";
import { ImportDialog } from "@/components/ImportDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { AlertTriangle, Download, Upload, X } from "lucide-react";
import { downloadEntityExport } from "@/lib/exportEntity";
import {
  completenessCountForWarehouse,
  idCollisionMessageForWarehouse,
  type PrecheckErrorLike,
} from "@/lib/precheckDisplay";
import { lookupCity } from "@/lib/gazetteer";
import { newUid, nextDisplayCode } from "@/lib/entityId";

// B5.2 — matches `addedWarehouseSchema` in
// artifacts/api-server/src/validation/inputs/pMedian.ts exactly (server-side
// source of truth for this shape).
export interface AddedWarehouse {
  id: string;
  city: string;
  state: string;
  lat: number;
  lng: number;
  capacity?: number | null;
  status: "active" | "forced_open" | "inactive";
  /** T9 — grid-mirror's auto-computed cosmetic label (T3's nextDisplayCode), same optional field CreateEntityDialog's map-click flow already writes. */
  displayCode?: string;
}

const ADDED_STATUSES = ["active", "forced_open", "inactive"] as const;
// Duplicated (not imported) from WarehouseTable.tsx's own STATUS_LABEL —
// deliberate, per this task's composition decision: WarehouseTable.tsx is
// shared with Studio.tsx and stays untouched, not even to export a
// constant. Three string literals is cheap enough to keep in sync by hand.
const ADDED_STATUS_LABEL: Record<(typeof ADDED_STATUSES)[number], string> = {
  active: "Potential",
  forced_open: "Fixed-Open",
  inactive: "Inactive",
};

interface WarehousesTabProps {
  warehouses: WarehouseCandidate[];
  overrides: WarehouseOverride[];
  capacityMode: "none" | "uniform" | "per_wh";
  onChange: (next: WarehouseOverride[]) => void;
  /** Undefined while the scenario hasn't resolved yet — Upload/Download stay disabled until it has. */
  scenarioId?: number;
  /** Fired after a successful import apply, with the updated scenario — the caller (Workspace.tsx) refreshes its inputs draft from it. */
  onImportApplied?: (scenario: Scenario) => void;
  /** A5.3 — this same component (WarehouseTable + Upload/Download toolbar) is
   * reused as two-echelon-gold-au's Refineries tab: `dataset.warehouses`
   * already carries both models' facility candidates (mine rows are filtered
   * out below regardless of entity), and the backend's import/export routes
   * already accept `entity=refineries` (routes/scenarios.ts) — only the
   * entity string threaded through here, the testids, and the ImportDialog
   * title need to change per model. Defaults to "warehouses" so every
   * existing p-median-us call site (and its tests) is unaffected. */
  entity?: "warehouses" | "refineries";
  /** B5.2/B6.2 — scenario-local addedWarehouses (`PMedianInputs`) or
   * addedRefineries (`TwoEchelonInputs`, B6.2 — Workspace.tsx binds this
   * same prop name to `inputs.addedRefineries` for the entity="refineries"
   * reuse; the shape happens to match exactly, `capacity` simply stays
   * unset/ignored since capacityMode is always "none" for refineries). This
   * section renders whenever the caller actually wires
   * `onAddedWarehousesChange` — capability-gated (see that prop's own
   * comment), not `entity`-gated, so it's a no-op unless a model has this
   * concept wired at all. */
  addedWarehouses?: AddedWarehouse[];
  /** Fired on both add (append) and in-row edits (status/capacity) — full
   * replacement array, same `onChange`-out convention as every other tab.
   * Whether this is wired at all is the actual gate on rendering the
   * "Added ..." section below (see `addedSection`'s own comment — fix,
   * mirroring CustomersTab.tsx's B5.2 gating bug fix: a per-model gate on
   * `entity` alone silently missed the next reuse, exactly this repo's
   * most-recurring bug class per CLAUDE.md's Rounds 1-5). */
  onAddedWarehousesChange?: (next: AddedWarehouse[]) => void;
  /** Fired on delete only — kept separate from onAddedWarehousesChange because the caller (Workspace.tsx) also needs to purge any distanceOverrides referencing this id in the SAME atomic inputs update, which a generic "here's the new array" diff can't express cleanly. */
  onDeleteWarehouse?: (id: string) => void;
  /** B2.1's precheck errors for the current scenario — drives the inline "missing N distances" chip on added rows. Undefined/omitted degrades to "no warnings shown", never a crash. */
  precheckErrors?: PrecheckErrorLike[];
  /** Phase 3.2, Task 4 — set by Workspace.tsx after an Input Map Confirm click. When non-null, opens the add-row form and pre-fills newLat/newLng, then calls onPrefillConsumed so Workspace.tsx clears it (one-shot, not a controlled value). */
  prefillCoords?: { lat: number; lng: number } | null;
  onPrefillConsumed?: () => void;
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
export function WarehousesTab({
  warehouses,
  overrides,
  capacityMode,
  onChange,
  scenarioId,
  onImportApplied,
  entity = "warehouses",
  addedWarehouses = [],
  onAddedWarehousesChange,
  onDeleteWarehouse,
  precheckErrors = [],
  prefillCoords,
  onPrefillConsumed,
}: WarehousesTabProps) {
  const [importOpen, setImportOpen] = useState(false);
  const candidates = warehouses.filter(w => w.kind !== "mine");
  const emptyLabel = entity === "refineries" ? "No refinery candidates in this dataset." : "No warehouse candidates in this dataset.";
  // B6.2 — singular label for the "Added ..." section's copy (heading,
  // empty message, button, id-collision error), entity-aware the same way
  // `emptyLabel` already is.
  const addedEntityLabel = entity === "refineries" ? "refinery" : "warehouse";

  // B5.2 — add-row form draft state, mirroring DistancesTab.tsx's own
  // addingRow/newX/addError pattern verbatim.
  const [addingRow, setAddingRow] = useState(false);
  const [newCity, setNewCity] = useState("");
  const [newState, setNewState] = useState("");
  const [newLat, setNewLat] = useState("");
  const [newLng, setNewLng] = useState("");
  const [newCapacity, setNewCapacity] = useState("");
  const [newDisplayCode, setNewDisplayCode] = useState("");
  const [addError, setAddError] = useState<string | null>(null);

  // T9 — grid-mirror: this form's identity model now matches
  // CreateEntityDialog's (T7) map-click flow exactly — `id` is a hidden T3
  // stable uid minted at commit time (never typed, never shown), and
  // `displayCode` (T3's nextDisplayCode) is the human-facing label, so a
  // row added here and a row added via the Input Map end up with the same
  // shape. There is no more manual "ID" input or id-collision check — a
  // random uid can't meaningfully collide.
  //
  // Auto-fill "touched" tracking: once a field is touched (the student
  // focused it themselves), it never gets silently overwritten by a later
  // City/State blur again.
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
      const existingCodes = addedWarehouses.map(w => w.displayCode).filter((c): c is string => !!c);
      setNewDisplayCode(nextDisplayCode("wh", state, city, existingCodes));
    }
  }

  // Phase 3.2, Task 4 — Input Map click-to-place prefill. One-shot: opens
  // the add-row form and pre-fills newLat/newLng, then reports back to
  // Workspace.tsx so it clears its own pendingPrefill state.
  useEffect(() => {
    if (!prefillCoords) return;
    setAddingRow(true);
    setNewLat(String(prefillCoords.lat));
    setNewLng(String(prefillCoords.lng));
    onPrefillConsumed?.();
  }, [prefillCoords, onPrefillConsumed]);

  function upsertAdded(id: string, patch: Partial<AddedWarehouse>) {
    if (!onAddedWarehousesChange) return;
    onAddedWarehousesChange(addedWarehouses.map(w => (w.id === id ? { ...w, ...patch } : w)));
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
    // T9 (team-lead decision) — displayCode is now the user-facing,
    // collision-checked field (the old "ID" input's role), since `id` is a
    // hidden uid that can't meaningfully collide. nextDisplayCode already
    // avoids collisions when it auto-generates one; this only fires if the
    // student manually typed/edited a displayCode that duplicates an
    // existing added warehouse's.
    const displayCode = newDisplayCode.trim() || undefined;
    if (displayCode && addedWarehouses.some(w => w.displayCode === displayCode)) {
      setAddError(`Display code '${displayCode}' is already in use by another ${addedEntityLabel} in this scenario.`);
      return;
    }
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      setAddError("Latitude and longitude must both be numbers.");
      return;
    }
    let capacity: number | null = null;
    if (newCapacity.trim() !== "") {
      const parsed = parseFloat(newCapacity);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        setAddError("Capacity must be a positive number, or left blank.");
        return;
      }
      capacity = parsed;
    }

    const id = newUid("wh");
    onAddedWarehousesChange?.([...addedWarehouses, { id, city, state, lat, lng, capacity, status: "active", displayCode }]);
    resetAddForm();
  }

  const toolbar = (
    <div className="flex items-center gap-1.5 mb-2" data-testid={`${entity}-tab-toolbar`}>
      <Button
        variant="outline"
        size="sm"
        onClick={() => scenarioId != null && downloadEntityExport(scenarioId, entity, "csv")}
        disabled={scenarioId == null}
        data-testid={`button-export-${entity}-csv`}
        className="h-7 text-xs"
      >
        <Download className="w-3.5 h-3.5 mr-1" /> CSV
      </Button>
      <Button
        variant="outline"
        size="sm"
        onClick={() => scenarioId != null && downloadEntityExport(scenarioId, entity, "json")}
        disabled={scenarioId == null}
        data-testid={`button-export-${entity}-json`}
        className="h-7 text-xs"
      >
        <Download className="w-3.5 h-3.5 mr-1" /> JSON
      </Button>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setImportOpen(true)}
        disabled={scenarioId == null}
        data-testid={`button-import-${entity}`}
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
      entity={entity}
      onApplied={onImportApplied}
    />
  );

  // B5.2/B6.2 — the "Added warehouses"/"Added refineries" section (add-row
  // form + delete/precheck per row). Per this task's composition decision,
  // this is a self-contained additional section next to WarehouseTable, NOT
  // a fork of it — base dataset rows (WarehouseTable, above) keep their
  // existing status-toggle-only affordance untouched; only entries actually
  // present in addedWarehouses ever get a delete button.
  //
  // Gated on `onAddedWarehousesChange != null` (capability-based), NOT
  // `entity === "warehouses"` — B6.2 fix, mirroring CustomersTab.tsx's own
  // B5.2 review fix exactly: two-echelon-gold-au's Refineries tab (this
  // component reused via entity="refineries") now HAS a real addedRefineries
  // concept on TwoEchelonInputs, so gating on the entity string alone would
  // have silently kept blocking it here too — the same recurring "gate
  // added on one branch, not its sibling reuse" bug class (CLAUDE.md's
  // Rounds 1-5). The label/testids below stay "warehouses"-worded
  // (WarehousesTab doesn't thread `entity` into this section) since neither
  // call site's students would be confused by it in context — Refineries is
  // this component's only OTHER reuse and there's no ambiguity about which
  // section is being edited.
  const addedSection = onAddedWarehousesChange != null && (
    <div className="mt-4" data-testid="added-warehouses-section">
      <h3 className="text-xs font-semibold text-muted-foreground mb-1.5">
        {entity === "refineries" ? "Added refineries" : "Added warehouses"}
      </h3>
      {addedWarehouses.length === 0 ? (
        <p className="text-xs text-muted-foreground mb-2" data-testid="added-warehouses-empty">
          No added {addedEntityLabel}s yet — use "+ Add {addedEntityLabel}" below to create one.
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
                {capacityMode === "per_wh" && <TableHead>Capacity</TableHead>}
                <TableHead>Status</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {addedWarehouses.map(w => {
                const missing = completenessCountForWarehouse(precheckErrors, w.id);
                const collision = idCollisionMessageForWarehouse(precheckErrors, w.id);
                return (
                  <TableRow key={w.id} data-testid={`row-added-warehouse-${w.id}`}>
                    <TableCell className="font-mono text-xs">
                      <div className="flex items-center gap-1">
                        {/* T9 — `id` is now a hidden T3 stable uid (see the
                          * grid-mirror comment above); `displayCode` is the
                          * human-facing label. Falls back to `id` only for
                          * pre-T9 data that never got one. */}
                        {w.displayCode ?? w.id}
                        {(missing != null || collision) && (
                          <span
                            title={collision ?? `Missing distances to ${missing} customer${missing === 1 ? "" : "s"} — see the Distances tab, or download/upload a template.`}
                            data-testid={`warning-precheck-added-warehouse-${w.id}`}
                            className="inline-flex items-center gap-0.5 text-[10px] text-amber-700 bg-amber-100 border border-amber-300 rounded px-1"
                          >
                            <AlertTriangle className="w-3 h-3" />
                            {collision ? "ID collision" : `Missing ${missing} distance${missing === 1 ? "" : "s"}`}
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-xs">{w.city}</TableCell>
                    <TableCell className="text-xs">{w.state}</TableCell>
                    <TableCell className="text-xs font-mono">{w.lat.toFixed(4)}</TableCell>
                    <TableCell className="text-xs font-mono">{w.lng.toFixed(4)}</TableCell>
                    {capacityMode === "per_wh" && (
                      <TableCell>
                        <Input
                          type="number"
                          min={0}
                          value={w.capacity ?? ""}
                          onChange={e => {
                            const raw = e.target.value;
                            upsertAdded(w.id, { capacity: raw === "" ? null : Math.max(0, parseFloat(raw) || 0) });
                          }}
                          className="h-7 text-xs w-28"
                          placeholder="uniform"
                          data-testid={`input-added-wh-capacity-${w.id}`}
                        />
                      </TableCell>
                    )}
                    <TableCell>
                      <div className="flex rounded border border-border overflow-hidden text-[10px] w-fit">
                        {ADDED_STATUSES.map(s => (
                          <button
                            key={s}
                            data-testid={`button-added-wh-${w.id}-${s}`}
                            onClick={() => upsertAdded(w.id, { status: s })}
                            className={`px-2 py-1 transition-colors whitespace-nowrap ${
                              w.status === s
                                ? s === "forced_open" ? "bg-primary text-white" : s === "inactive" ? "bg-destructive text-white" : "bg-slate-200 text-foreground"
                                : "bg-white text-muted-foreground hover:bg-muted"
                            }`}
                          >
                            {ADDED_STATUS_LABEL[s]}
                          </button>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell>
                      <button
                        type="button"
                        aria-label={`Delete added warehouse ${w.id}`}
                        onClick={() => onDeleteWarehouse?.(w.id)}
                        data-testid={`button-delete-added-warehouse-${w.id}`}
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
        <div className="flex items-start gap-1.5 flex-wrap" data-testid="add-warehouse-row-form">
          <Input
            placeholder="City"
            value={newCity}
            onChange={e => setNewCity(e.target.value)}
            onBlur={handleCityStateBlur}
            className="h-7 text-xs w-28"
            data-testid="input-new-warehouse-city"
          />
          <Input
            placeholder="State"
            value={newState}
            onChange={e => setNewState(e.target.value)}
            onBlur={handleCityStateBlur}
            className="h-7 text-xs w-16"
            data-testid="input-new-warehouse-state"
          />
          <Input
            type="number"
            placeholder="Lat"
            value={newLat}
            onChange={e => setNewLat(e.target.value)}
            onFocus={touchLat}
            className={`h-7 text-xs w-20 ${!latTouched && newLat ? "bg-muted text-muted-foreground" : ""}`}
            data-testid="input-new-warehouse-lat"
          />
          <Input
            type="number"
            placeholder="Lng"
            value={newLng}
            onChange={e => setNewLng(e.target.value)}
            onFocus={touchLng}
            className={`h-7 text-xs w-20 ${!lngTouched && newLng ? "bg-muted text-muted-foreground" : ""}`}
            data-testid="input-new-warehouse-lng"
          />
          <Input
            placeholder="Display code (auto)"
            value={newDisplayCode}
            onChange={e => setNewDisplayCode(e.target.value)}
            onFocus={touchDisplayCode}
            className={`h-7 text-xs w-32 ${!displayCodeTouched && newDisplayCode ? "bg-muted text-muted-foreground" : ""}`}
            data-testid="input-new-warehouse-display-code"
          />
          {capacityMode === "per_wh" && (
            <Input type="number" placeholder="Capacity" value={newCapacity} onChange={e => setNewCapacity(e.target.value)} className="h-7 text-xs w-24" data-testid="input-new-warehouse-capacity" />
          )}
          <Button size="sm" className="h-7 px-2 text-xs" onClick={handleAddRow} data-testid="button-add-warehouse-confirm">
            Add
          </Button>
          <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={resetAddForm} data-testid="button-add-warehouse-cancel">
            Cancel
          </Button>
        </div>
      ) : (
        <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => setAddingRow(true)} data-testid="button-add-warehouse-row">
          + Add {addedEntityLabel}
        </Button>
      )}
      {addError && (
        <p className="text-[11px] text-destructive mt-1" data-testid="text-add-warehouse-error">
          {addError}
        </p>
      )}
    </div>
  );

  if (candidates.length === 0) {
    return (
      <div>
        {toolbar}
        <p className="text-sm text-muted-foreground" data-testid={`${entity}-tab-empty`}>
          {emptyLabel}
        </p>
        {addedSection}
        {importDialog}
      </div>
    );
  }

  return (
    <div data-testid={`${entity}-tab`}>
      {toolbar}
      <WarehouseTable warehouses={candidates} overrides={overrides} capacityMode={capacityMode} onChange={onChange} />
      {addedSection}
      {importDialog}
    </div>
  );
}
