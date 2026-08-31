import { useEffect, useState } from "react";
import { AlertTriangle, Download, Upload, X } from "lucide-react";
import type { Scenario } from "@workspace/api-client-react";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ImportDialog } from "@/components/ImportDialog";
import { downloadEntityExport } from "@/lib/exportEntity";

export interface DistanceOverride {
  fromId: string;
  toId: string;
  distance: number;
  /** T1 (Input Map v2) — true when this row was auto-filled by the backend's
   * haversine normalizer (services/autoDistance.ts) rather than entered or
   * imported by the student. Matches distanceOverrideSchema's own optional
   * `estimated` field exactly. Purely a display flag — editing the distance
   * (see `updateDistance`) drops it, treating the edit as a confirmation. */
  estimated?: boolean;
}

interface DistancesTabProps {
  /** The scenario's CURRENT distanceOverrides array (localInputs draft) —
   * unlike Warehouses/Customers, there's no fixed baseline to enumerate
   * (B4.3's same reasoning for the distances export): this grid shows
   * exactly what the student has explicitly set, not a merged full dataset. */
  distanceOverrides: DistanceOverride[];
  /** The last-SAVED distanceOverrides array (savedInputsRef.current, read at
   * the Workspace.tsx call site) — diffed against `distanceOverrides` purely
   * to drive the changed-row highlight. Never written to. */
  savedDistanceOverrides: DistanceOverride[];
  /** Known warehouse ids (base dataset + any scenario-local addedWarehouses)
   * — used only for a cheap client-side existence check ("does this fromId
   * look resolvable"). B2.1's server-side precheck remains the authoritative
   * check the Solve flow actually gates on; this is a nice-to-have early
   * warning, not a duplicate of that authority. */
  warehouseIds: string[];
  customerIds: string[];
  onChange: (next: DistanceOverride[]) => void;
  /** Undefined while the scenario hasn't resolved yet — Upload/Download stay disabled until it has. */
  scenarioId?: number;
  /** Fired after a successful import apply, with the updated scenario — the caller (Workspace.tsx) refreshes its inputs draft from it. */
  onImportApplied?: (scenario: Scenario) => void;
  /** Phase 3.2, Task 4 — when set, scroll/highlight the row(s) referencing this entity id (the post-Save precheck toast's "jump to it" action). Cleared by the consumer after use — this component doesn't clear it itself. */
  focusEntityId?: string | null;
}

function pairKey(fromId: string, toId: string): string {
  return `${fromId}|${toId}`;
}

// B5.1 — long-format `{fromId, toId, distance}` grid over scenario.inputs'
// distanceOverrides array (B1.1). Thin wrapper following WarehousesTab.tsx's
// shape (props in, onChange out, no internal data-fetching/save logic) — but
// unlike WarehousesTab/CustomersTab there's no fixed dataset baseline to
// enumerate rows from, so this component owns its own inline table rather
// than wrapping a components/tables/*Table.tsx (mirrors
// OptimizationParametersTab.tsx's precedent of a Workspace tab with no
// separate table component underneath it).
export function DistancesTab({
  distanceOverrides,
  savedDistanceOverrides,
  warehouseIds,
  customerIds,
  onChange,
  scenarioId,
  onImportApplied,
  focusEntityId,
}: DistancesTabProps) {
  const [fromFilter, setFromFilter] = useState("");
  const [toFilter, setToFilter] = useState("");
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [importOpen, setImportOpen] = useState(false);
  const [addingRow, setAddingRow] = useState(false);
  const [newFrom, setNewFrom] = useState("");
  const [newTo, setNewTo] = useState("");
  const [newDistance, setNewDistance] = useState("");
  const [addError, setAddError] = useState<string | null>(null);

  // Phase 3.2, Task 4 — post-Save precheck toast's "jump to it" action.
  // Rows use this component's own existing `row-distance-${fromId}-${toId}`
  // testid pattern (reused, not a new one) — matches on either side, since
  // the newly-added entity could be either fromId (a warehouse) or toId (a
  // customer).
  useEffect(() => {
    if (!focusEntityId) return;
    const prefix = "row-distance-";
    const rows = document.querySelectorAll(`[data-testid^="${prefix}"]`);
    for (const row of Array.from(rows)) {
      const testid = row.getAttribute("data-testid") ?? "";
      // "row-distance-${fromId}-${toId}" — matched by boundary, not a naive
      // split on "-", since either id can itself contain hyphens.
      const suffix = testid.slice(prefix.length);
      if (suffix.startsWith(`${focusEntityId}-`) || suffix.endsWith(`-${focusEntityId}`)) {
        row.scrollIntoView({ block: "center" });
        break;
      }
    }
  }, [focusEntityId]);

  const warehouseIdSet = new Set(warehouseIds);
  const customerIdSet = new Set(customerIds);
  const savedByKey = new Map(savedDistanceOverrides.map(o => [pairKey(o.fromId, o.toId), o.distance]));

  const visibleRows = distanceOverrides.filter(
    o =>
      o.fromId.toLowerCase().includes(fromFilter.toLowerCase()) &&
      o.toId.toLowerCase().includes(toFilter.toLowerCase()),
  );

  function isChanged(o: DistanceOverride): boolean {
    const saved = savedByKey.get(pairKey(o.fromId, o.toId));
    return saved === undefined || saved !== o.distance;
  }

  function updateDistance(fromId: string, toId: string, raw: string) {
    const key = pairKey(fromId, toId);
    setDrafts(prev => ({ ...prev, [key]: raw }));
    const parsed = parseFloat(raw);
    if (!Number.isFinite(parsed) || parsed <= 0) return;
    // Editing an estimated row is a confirm action — it stops being
    // machine-filled the moment a student vouches for a number themselves.
    onChange(
      distanceOverrides.map(o =>
        o.fromId === fromId && o.toId === toId ? { ...o, distance: parsed, estimated: undefined } : o,
      ),
    );
  }

  function removeRow(fromId: string, toId: string) {
    onChange(distanceOverrides.filter(o => !(o.fromId === fromId && o.toId === toId)));
  }

  function handleAddRow() {
    const fromId = newFrom.trim();
    const toId = newTo.trim();
    const distance = parseFloat(newDistance);

    if (!fromId || !toId) {
      setAddError("From ID and To ID are both required.");
      return;
    }
    if (!Number.isFinite(distance) || distance <= 0) {
      setAddError("Distance must be a positive number.");
      return;
    }
    if (distanceOverrides.some(o => o.fromId === fromId && o.toId === toId)) {
      setAddError("A distance override for this pair already exists — edit it in the table instead.");
      return;
    }

    setAddError(null);
    onChange([...distanceOverrides, { fromId, toId, distance }]);
    setNewFrom("");
    setNewTo("");
    setNewDistance("");
    setAddingRow(false);
  }

  function cancelAddRow() {
    setAddingRow(false);
    setNewFrom("");
    setNewTo("");
    setNewDistance("");
    setAddError(null);
  }

  const toolbar = (
    <div className="flex items-center gap-1.5 mb-2 flex-wrap" data-testid="distances-tab-toolbar">
      <Button
        variant="outline"
        size="sm"
        onClick={() => scenarioId != null && downloadEntityExport(scenarioId, "distances", "csv")}
        disabled={scenarioId == null}
        data-testid="button-export-distances-csv"
        className="h-7 text-xs"
      >
        <Download className="w-3.5 h-3.5 mr-1" /> CSV
      </Button>
      <Button
        variant="outline"
        size="sm"
        onClick={() => scenarioId != null && downloadEntityExport(scenarioId, "distances", "json")}
        disabled={scenarioId == null}
        data-testid="button-export-distances-json"
        className="h-7 text-xs"
      >
        <Download className="w-3.5 h-3.5 mr-1" /> JSON
      </Button>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setImportOpen(true)}
        disabled={scenarioId == null}
        data-testid="button-import-distances"
        className="h-7 text-xs"
      >
        <Upload className="w-3.5 h-3.5 mr-1" /> Upload
      </Button>
      <div className="flex-1" />
      <Input
        placeholder="Filter from ID…"
        value={fromFilter}
        onChange={e => setFromFilter(e.target.value)}
        className="h-7 text-xs w-36"
        data-testid="input-filter-from"
      />
      <Input
        placeholder="Filter to ID…"
        value={toFilter}
        onChange={e => setToFilter(e.target.value)}
        className="h-7 text-xs w-36"
        data-testid="input-filter-to"
      />
    </div>
  );

  // Mounted only while actually open — mirrors WarehousesTab/CustomersTab's
  // gating (ImportDialog fires its preview/apply hooks unconditionally on
  // render).
  const importDialog = importOpen && scenarioId != null && (
    <ImportDialog
      open={importOpen}
      onOpenChange={setImportOpen}
      scenarioId={scenarioId}
      entity="distances"
      onApplied={onImportApplied}
    />
  );

  const addRowUi = addingRow ? (
    <div className="flex items-start gap-1.5 mt-2" data-testid="add-distance-row-form">
      <Input
        placeholder="From ID (warehouse)"
        value={newFrom}
        onChange={e => setNewFrom(e.target.value)}
        className="h-7 text-xs w-36"
        data-testid="input-new-distance-from"
      />
      <Input
        placeholder="To ID (customer)"
        value={newTo}
        onChange={e => setNewTo(e.target.value)}
        className="h-7 text-xs w-36"
        data-testid="input-new-distance-to"
      />
      <Input
        type="number"
        placeholder="Distance"
        value={newDistance}
        onChange={e => setNewDistance(e.target.value)}
        className="h-7 text-xs w-24"
        data-testid="input-new-distance-value"
      />
      <Button size="sm" className="h-7 px-2 text-xs" onClick={handleAddRow} data-testid="button-add-distance-confirm">
        Add
      </Button>
      <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={cancelAddRow} data-testid="button-add-distance-cancel">
        Cancel
      </Button>
    </div>
  ) : (
    <Button
      size="sm"
      variant="outline"
      className="h-7 px-2 text-xs mt-2"
      onClick={() => setAddingRow(true)}
      data-testid="button-add-distance-row"
    >
      + Add row
    </Button>
  );

  return (
    <div data-testid="distances-tab">
      {toolbar}

      {distanceOverrides.length === 0 ? (
        <p className="text-sm text-muted-foreground" data-testid="distances-tab-empty">
          No distance overrides yet — add one below, or upload a CSV/JSON file.
        </p>
      ) : (
        <div className="max-h-[55vh] overflow-y-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>From (warehouse)</TableHead>
                <TableHead>To (customer)</TableHead>
                <TableHead>Distance</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleRows.map(o => {
                const key = pairKey(o.fromId, o.toId);
                const changed = isChanged(o);
                const fromUnknown = !warehouseIdSet.has(o.fromId);
                const toUnknown = !customerIdSet.has(o.toId);
                return (
                  <TableRow
                    key={key}
                    data-testid={`row-distance-${o.fromId}-${o.toId}`}
                    className={changed ? "bg-amber-50" : o.estimated ? "bg-sky-50" : undefined}
                  >
                    <TableCell className="font-mono text-xs">
                      <div className="flex items-center gap-1">
                        {o.fromId}
                        {fromUnknown && (
                          <span
                            title="Unknown warehouse ID — not found in this scenario's warehouses"
                            data-testid={`warning-unknown-from-${o.fromId}-${o.toId}`}
                          >
                            <AlertTriangle className="w-3 h-3 text-amber-600" />
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      <div className="flex items-center gap-1">
                        {o.toId}
                        {toUnknown && (
                          <span
                            title="Unknown customer ID — not found in this scenario's customers"
                            data-testid={`warning-unknown-to-${o.fromId}-${o.toId}`}
                          >
                            <AlertTriangle className="w-3 h-3 text-amber-600" />
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5">
                        <Input
                          type="number"
                          min={0}
                          value={drafts[key] ?? String(o.distance)}
                          onChange={e => updateDistance(o.fromId, o.toId, e.target.value)}
                          className="h-7 text-xs w-24"
                          data-testid={`input-distance-${o.fromId}-${o.toId}`}
                        />
                        {o.estimated && (
                          <span
                            className="text-[10px] text-sky-700 bg-sky-100 border border-sky-300 rounded px-1"
                            data-testid={`badge-distance-estimated-${o.fromId}-${o.toId}`}
                          >
                            Estimated
                          </span>
                        )}
                        {changed && (
                          <span
                            className="text-[10px] text-amber-700 bg-amber-100 border border-amber-300 rounded px-1"
                            data-testid={`badge-distance-changed-${o.fromId}-${o.toId}`}
                          >
                            Changed
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <button
                        type="button"
                        aria-label={`Remove distance override ${o.fromId} → ${o.toId}`}
                        onClick={() => removeRow(o.fromId, o.toId)}
                        data-testid={`button-remove-distance-${o.fromId}-${o.toId}`}
                        className="text-muted-foreground hover:text-destructive"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </TableCell>
                  </TableRow>
                );
              })}
              {visibleRows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="text-xs text-muted-foreground text-center py-3">
                    No rows match the current filter.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      )}

      {addRowUi}
      {addError && (
        <p className="text-[11px] text-destructive mt-1" data-testid="text-add-distance-error">
          {addError}
        </p>
      )}

      {importDialog}
    </div>
  );
}
