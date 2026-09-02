import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Download, Upload, X } from "lucide-react";
import type { Scenario } from "@workspace/api-client-react";
import { useGetReferenceDistances, getGetReferenceDistancesQueryKey } from "@workspace/api-client-react";
import { useVirtualizer } from "@tanstack/react-virtual";
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
  /** Followup — scenario-local added entities' `id -> displayCode` map (Workspace.tsx builds this from addedWarehouses/addedCustomers). From/To cells look up through this for DISPLAY ONLY — the underlying stored fromId/toId (the uuid) stays the join key everywhere else (existence checks, edits, removal). Base dataset ids have no entry here and fall back to showing the raw id, unchanged. */
  displayCodeById?: Record<string, string>;
  /** B3 (Bundle 2.2) — the active model's id, used to fetch its reference-distance
   * matrix. Optional: absent (or `referenceCapable` false) hides the reference
   * section entirely — T9 wires the real value at the Workspace.tsx call site. */
  modelId?: string;
  /** B3 — mirrors `manifest.capabilities.supportsReferenceDistances` for the
   * active model. The reference section only renders (and the fetch only
   * fires) when this is true AND `modelId` is set — an unsupported model
   * (e.g. Brazil) must never issue the request (would 422 server-side). */
  referenceCapable?: boolean;
  /** B3 — base-dataset warehouse ids currently INACTIVE in the scenario's live
   * (unsaved) `localInputs` draft (status not potential/fixed-open). Purely a
   * view filter over the immutable reference matrix — never refetched, just
   * hides rows whose warehouse endpoint is presently inactive. */
  inactiveWarehouseIds?: string[];
  /** B3 — base-dataset customer ids currently EXCLUDED in the scenario's live
   * `localInputs` draft. Same filter semantics as `inactiveWarehouseIds`. */
  excludedCustomerIds?: string[];
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
  displayCodeById,
  modelId,
  referenceCapable,
  inactiveWarehouseIds,
  excludedCustomerIds,
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

  // B3 (Bundle 2.2) — called UNCONDITIONALLY (Rules of Hooks) with `enabled`
  // gating the actual request: an unsupported model (referenceCapable false,
  // e.g. Brazil) or an unresolved modelId must never fire this request (the
  // server 422s an unsupported model). `staleTime: Infinity` — the base
  // matrix is immutable (DD-1), fetched once per model per session; a tab
  // remount must not revalidate.
  const referenceEnabled = Boolean(referenceCapable && modelId);
  const referenceQuery = useGetReferenceDistances(modelId ?? "", {
    query: {
      enabled: referenceEnabled,
      staleTime: Infinity,
      queryKey: getGetReferenceDistancesQueryKey(modelId ?? ""),
    },
  });

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

  // B3 — client-side view filter over the immutable base×base reference
  // matrix (DD-1: base data never mutates). Purely derived from live
  // `localInputs`-sourced status props — no refetch, instant recompute on
  // every render. Only base-dataset rows are ever present in the reference
  // response, so added entities never appear here regardless of status.
  const inactiveWarehouseIdSet = useMemo(
    () => new Set(inactiveWarehouseIds ?? []),
    [inactiveWarehouseIds],
  );
  const excludedCustomerIdSet = useMemo(
    () => new Set(excludedCustomerIds ?? []),
    [excludedCustomerIds],
  );
  const referencePairs = referenceQuery.data?.pairs ?? [];
  const visibleReferencePairs = useMemo(
    () =>
      referencePairs.filter(
        p => !inactiveWarehouseIdSet.has(p.fromId) && !excludedCustomerIdSet.has(p.toId),
      ),
    [referencePairs, inactiveWarehouseIdSet, excludedCustomerIdSet],
  );
  const referenceScrollRef = useRef<HTMLDivElement>(null);
  const referenceVirtualizer = useVirtualizer({
    count: visibleReferencePairs.length,
    getScrollElement: () => referenceScrollRef.current,
    estimateSize: () => 28,
    overscan: 10,
  });

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

  // B3 (Bundle 2.2) — read-only base×base reference-distance section, above
  // the editable overrides grid. Gated on the `referenceCapable` prop alone
  // (not `modelId`) per spec: an unsupported model must simply not render
  // this section at all (back-compat default: both props absent → hidden).
  const referenceTotal = visibleReferencePairs.length;
  const referenceSection = referenceCapable ? (
    <div className="mb-4 border rounded-md" data-testid="distances-reference-section">
      <div className="flex items-center justify-between px-2 py-1.5 border-b bg-muted/40">
        <span className="text-xs font-medium">Base distances (reference)</span>
        <span className="text-[11px] text-muted-foreground" data-testid="distances-reference-total">
          {referenceTotal} pair{referenceTotal === 1 ? "" : "s"}
        </span>
      </div>
      {referenceQuery.isLoading && (
        <p className="text-xs text-muted-foreground px-2 py-2" data-testid="distances-reference-loading">
          Loading reference distances…
        </p>
      )}
      {referenceQuery.isError && (
        <p className="text-xs text-destructive px-2 py-2" data-testid="distances-reference-error">
          Failed to load reference distances.
        </p>
      )}
      {!referenceQuery.isLoading && !referenceQuery.isError && (
        <div>
          <div className="flex text-[11px] font-medium text-muted-foreground px-2 py-1 border-b">
            <div className="w-1/3">From</div>
            <div className="w-1/3">To</div>
            <div className="w-1/3">Distance</div>
          </div>
          <div
            ref={referenceScrollRef}
            className="max-h-[220px] overflow-y-auto relative"
            data-testid="distances-reference-scroll"
          >
            <div style={{ height: referenceVirtualizer.getTotalSize(), position: "relative" }}>
              {referenceVirtualizer.getVirtualItems().map(virtualRow => {
                const pair = visibleReferencePairs[virtualRow.index];
                if (!pair) return null;
                return (
                  <div
                    key={`${pair.fromId}|${pair.toId}`}
                    data-testid={`row-reference-distance-${pair.fromId}-${pair.toId}`}
                    className="flex items-center text-xs px-2 border-b absolute top-0 left-0 w-full"
                    style={{ height: virtualRow.size, transform: `translateY(${virtualRow.start}px)` }}
                  >
                    <div className="w-1/3 font-mono">{pair.fromCode}</div>
                    <div className="w-1/3 font-mono">{pair.toCode}</div>
                    <div className="w-1/3">
                      {pair.distance} {referenceQuery.data?.distanceUnit ?? ""}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  ) : null;

  return (
    <div data-testid="distances-tab">
      {referenceSection}
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
                        {displayCodeById?.[o.fromId] ?? o.fromId}
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
                        {displayCodeById?.[o.toId] ?? o.toId}
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
