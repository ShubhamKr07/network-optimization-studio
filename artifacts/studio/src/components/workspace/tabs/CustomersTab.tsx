import { useState } from "react";
import type { Customer, Scenario } from "@workspace/api-client-react";
import { CustomerTable, type CustomerOverride } from "@/components/tables/CustomerTable";
import { ImportDialog } from "@/components/ImportDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { AlertTriangle, Download, Upload, X } from "lucide-react";
import { downloadEntityExport } from "@/lib/exportEntity";
import {
  completenessCountForCustomer,
  idCollisionMessageForCustomer,
  type PrecheckErrorLike,
} from "@/lib/precheckDisplay";

// B5.2 — matches `addedCustomerSchema` in
// artifacts/api-server/src/validation/inputs/pMedian.ts exactly (server-side
// source of truth for this shape). No `status` field — precheck.ts's own
// comment: "v1 has no way to add a customer and mark it excluded in the
// same breath" — every added customer counts as active, always.
export interface AddedCustomer {
  id: string;
  city: string;
  state: string;
  lat: number;
  lng: number;
  demand: number;
}

interface CustomersTabProps {
  customers: Customer[];
  overrides: CustomerOverride[];
  onChange: (next: CustomerOverride[]) => void;
  /** Undefined while the scenario hasn't resolved yet — Upload/Download stay disabled until it has. */
  scenarioId?: number;
  /** Fired after a successful import apply, with the updated scenario — the caller (Workspace.tsx) refreshes its inputs draft from it. */
  onImportApplied?: (scenario: Scenario) => void;
  /** B5.2 — scenario-local addedCustomers (B1.1), p-median-us only (two-echelon-gold-au's CustomersTab call site omits these props — its own inputs schema has no addedCustomers field). */
  addedCustomers?: AddedCustomer[];
  /** Fired on both add (append) and in-row edits (demand) — full replacement array, same `onChange`-out convention as every other tab. */
  onAddedCustomersChange?: (next: AddedCustomer[]) => void;
  /** Fired on delete only — kept separate from onAddedCustomersChange because the caller (Workspace.tsx) also needs to purge any distanceOverrides referencing this id in the SAME atomic inputs update. */
  onDeleteCustomer?: (id: string) => void;
  /** B2.1's precheck errors for the current scenario — drives the inline "missing N distances" chip on added rows. */
  precheckErrors?: PrecheckErrorLike[];
}

// A1.1 — thin Workspace-tab wrapper around the existing CustomerTable (built
// for Studio.tsx's Overrides dialog, D3.1). Re-homed as-is, no fork.
//
// A1.3 — Upload/Download toolbar, wired to the existing ImportDialog
// (preview -> apply flow, reused as-is) and the existing exportScenario
// fetch function (via lib/exportEntity's shared download helper) — same
// components/flow Studio.tsx already uses, replicated here rather than
// rebuilt.
export function CustomersTab({
  customers,
  overrides,
  onChange,
  scenarioId,
  onImportApplied,
  addedCustomers = [],
  onAddedCustomersChange,
  onDeleteCustomer,
  precheckErrors = [],
}: CustomersTabProps) {
  const [importOpen, setImportOpen] = useState(false);

  // B5.2 — add-row form draft state, mirroring WarehousesTab.tsx/
  // DistancesTab.tsx's own addingRow/newX/addError pattern verbatim.
  const [addingRow, setAddingRow] = useState(false);
  const [newId, setNewId] = useState("");
  const [newCity, setNewCity] = useState("");
  const [newState, setNewState] = useState("");
  const [newLat, setNewLat] = useState("");
  const [newLng, setNewLng] = useState("");
  const [newDemand, setNewDemand] = useState("");
  const [addError, setAddError] = useState<string | null>(null);

  const knownCustomerIds = new Set([...customers.map(c => c.id), ...addedCustomers.map(c => c.id)]);

  function upsertAddedDemand(id: string, demand: number) {
    onAddedCustomersChange?.(addedCustomers.map(c => (c.id === id ? { ...c, demand } : c)));
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
    if (knownCustomerIds.has(id)) {
      setAddError(`ID '${id}' is already in use by another customer in this scenario.`);
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

    onAddedCustomersChange?.([...addedCustomers, { id, city, state, lat, lng, demand }]);
    resetAddForm();
  }

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

  // B5.2 — the "Added customers" section (add-row form + delete/precheck per
  // row), mirroring WarehousesTab.tsx's own addedSection. Base dataset rows
  // (CustomerTable, above) keep their existing status-toggle-only
  // affordance untouched; only entries actually present in addedCustomers
  // ever get a delete button. No status column here — addedCustomerSchema
  // has no status field (see the AddedCustomer type comment above).
  //
  // Fix (code review) — gated on `onAddedCustomersChange != null`, mirroring
  // WarehousesTab's own `entity === "warehouses"` gate. CustomersTab has no
  // `entity` prop to key off (it's shared as-is by p-median-us AND
  // two-echelon-gold-au, unlike WarehousesTab's warehouses/refineries
  // split), so the added-entity capability itself — whether the caller
  // actually wired onAddedCustomersChange — is the correct signal:
  // Workspace.tsx already omits ALL THREE added-* props together for
  // two-echelon-gold-au (addedCustomers is a p-median-us-only field on
  // PMedianInputs), so this is equivalent to "only p-median-us" today
  // without hardcoding a model check here. Without this gate, two-echelon
  // rendered a live-looking "+ Add customer" button whose Add click called
  // an undefined onAddedCustomersChange (silently no-op'd) while
  // resetAddForm() still cleared the form unconditionally — the student saw
  // no error and nothing was added. Exactly this repo's most-documented
  // recurring bug class (CLAUDE.md's Rounds 1-5): a per-model gate added on
  // one branch (WarehousesTab) but not its sibling (CustomersTab).
  const addedSection = onAddedCustomersChange != null && (
    <div className="mt-4" data-testid="added-customers-section">
      <h3 className="text-xs font-semibold text-muted-foreground mb-1.5">Added customers</h3>
      {addedCustomers.length === 0 ? (
        <p className="text-xs text-muted-foreground mb-2" data-testid="added-customers-empty">
          No added customers yet — use "+ Add customer" below to create one.
        </p>
      ) : (
        <div className="max-h-[40vh] overflow-y-auto mb-2">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>ID</TableHead>
                <TableHead>City, State</TableHead>
                <TableHead>Demand</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {addedCustomers.map(c => {
                const missing = completenessCountForCustomer(precheckErrors, c.id);
                const collision = idCollisionMessageForCustomer(precheckErrors, c.id);
                return (
                  <TableRow key={c.id} data-testid={`row-added-customer-${c.id}`}>
                    <TableCell className="font-mono text-xs">
                      <div className="flex items-center gap-1">
                        {c.id}
                        {(missing > 0 || collision) && (
                          <span
                            title={collision ?? `${missing} warehouse${missing === 1 ? " lacks" : "s lack"} a distance to this customer — see the Distances tab, or download/upload a template.`}
                            data-testid={`warning-precheck-added-customer-${c.id}`}
                            className="inline-flex items-center gap-0.5 text-[10px] text-amber-700 bg-amber-100 border border-amber-300 rounded px-1"
                          >
                            <AlertTriangle className="w-3 h-3" />
                            {collision ? "ID collision" : `Missing ${missing} distance${missing === 1 ? "" : "s"}`}
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-xs">{c.city}, {c.state}</TableCell>
                    <TableCell>
                      <Input
                        type="number"
                        min={0}
                        value={c.demand}
                        onChange={e => {
                          const parsed = Number(e.target.value);
                          if (Number.isFinite(parsed) && parsed >= 0) upsertAddedDemand(c.id, parsed);
                        }}
                        className="h-7 text-xs w-28"
                        data-testid={`input-added-customer-demand-${c.id}`}
                      />
                    </TableCell>
                    <TableCell>
                      <button
                        type="button"
                        aria-label={`Delete added customer ${c.id}`}
                        onClick={() => onDeleteCustomer?.(c.id)}
                        data-testid={`button-delete-added-customer-${c.id}`}
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
        <div className="flex items-start gap-1.5 flex-wrap" data-testid="add-customer-row-form">
          <Input placeholder="ID" value={newId} onChange={e => setNewId(e.target.value)} className="h-7 text-xs w-24" data-testid="input-new-customer-id" />
          <Input placeholder="City" value={newCity} onChange={e => setNewCity(e.target.value)} className="h-7 text-xs w-28" data-testid="input-new-customer-city" />
          <Input placeholder="State" value={newState} onChange={e => setNewState(e.target.value)} className="h-7 text-xs w-16" data-testid="input-new-customer-state" />
          <Input type="number" placeholder="Lat" value={newLat} onChange={e => setNewLat(e.target.value)} className="h-7 text-xs w-20" data-testid="input-new-customer-lat" />
          <Input type="number" placeholder="Lng" value={newLng} onChange={e => setNewLng(e.target.value)} className="h-7 text-xs w-20" data-testid="input-new-customer-lng" />
          <Input type="number" placeholder="Demand" value={newDemand} onChange={e => setNewDemand(e.target.value)} className="h-7 text-xs w-24" data-testid="input-new-customer-demand" />
          <Button size="sm" className="h-7 px-2 text-xs" onClick={handleAddRow} data-testid="button-add-customer-confirm">
            Add
          </Button>
          <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={resetAddForm} data-testid="button-add-customer-cancel">
            Cancel
          </Button>
        </div>
      ) : (
        <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => setAddingRow(true)} data-testid="button-add-customer-row">
          + Add customer
        </Button>
      )}
      {addError && (
        <p className="text-[11px] text-destructive mt-1" data-testid="text-add-customer-error">
          {addError}
        </p>
      )}
    </div>
  );

  if (customers.length === 0) {
    return (
      <div>
        {toolbar}
        <p className="text-sm text-muted-foreground" data-testid="customers-tab-empty">
          No customers in this dataset.
        </p>
        {addedSection}
        {importDialog}
      </div>
    );
  }

  return (
    <div data-testid="customers-tab">
      {toolbar}
      <CustomerTable customers={customers} overrides={overrides} onChange={onChange} />
      {addedSection}
      {importDialog}
    </div>
  );
}
