import { useState } from "react";
import { AlertTriangle, Download, Upload, X } from "lucide-react";
import type { Scenario } from "@workspace/api-client-react";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ImportDialog } from "@/components/ImportDialog";
import { downloadEntityExport } from "@/lib/exportEntity";

export interface LaneCostOverride {
  fromId: string;
  toId: string;
  cost: number;
}

interface LaneCostsTabProps {
  /** The scenario's CURRENT laneCostOverrides array (localInputs draft) —
   * unlike Mines/Stations, there's no fixed baseline to enumerate (mirrors
   * DistancesTab's own reasoning, B4.3): this grid shows exactly what the
   * student has explicitly set, not a merged full dataset. */
  laneCostOverrides: LaneCostOverride[];
  /** The last-SAVED laneCostOverrides array (savedInputsRef.current, read at
   * the Workspace.tsx call site) — diffed against `laneCostOverrides` purely
   * to drive the changed-row highlight. Never written to. */
  savedLaneCostOverrides: LaneCostOverride[];
  /** Known mine ids (base dataset + any scenario-local addedMines) — used
   * only for a cheap client-side existence check ("does this fromId look
   * resolvable"). B6.1 stage 3's server-side precheck remains the
   * authoritative check the Solve flow actually gates on; this is a
   * nice-to-have early warning, not a duplicate of that authority. */
  mineIds: string[];
  stationIds: string[];
  onChange: (next: LaneCostOverride[]) => void;
  /** Undefined while the scenario hasn't resolved yet — Upload/Download stay disabled until it has. */
  scenarioId?: number;
  /** Fired after a successful import apply, with the updated scenario — the caller (Workspace.tsx) refreshes its inputs draft from it. */
  onImportApplied?: (scenario: Scenario) => void;
}

function pairKey(fromId: string, toId: string): string {
  return `${fromId}|${toId}`;
}

// Task 30 (B6.1 stage 4) — transport-coal's "Lane costs" grid tab, the
// mine/station analogue of B5.1's DistancesTab.tsx (long-format
// {fromId, toId, cost} grid, from/to filters, changed-row highlight, add-row,
// Upload/Download wired to the new laneCosts backend entity) — closely
// mirrors that component's structure, field name (`cost` not `distance`) and
// vocabulary ("mine"/"station") aside, per stage 1-3's own established
// naming decision for this model.
export function LaneCostsTab({
  laneCostOverrides,
  savedLaneCostOverrides,
  mineIds,
  stationIds,
  onChange,
  scenarioId,
  onImportApplied,
}: LaneCostsTabProps) {
  const [fromFilter, setFromFilter] = useState("");
  const [toFilter, setToFilter] = useState("");
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [importOpen, setImportOpen] = useState(false);
  const [addingRow, setAddingRow] = useState(false);
  const [newFrom, setNewFrom] = useState("");
  const [newTo, setNewTo] = useState("");
  const [newCost, setNewCost] = useState("");
  const [addError, setAddError] = useState<string | null>(null);

  const mineIdSet = new Set(mineIds);
  const stationIdSet = new Set(stationIds);
  const savedByKey = new Map(savedLaneCostOverrides.map(o => [pairKey(o.fromId, o.toId), o.cost]));

  const visibleRows = laneCostOverrides.filter(
    o =>
      o.fromId.toLowerCase().includes(fromFilter.toLowerCase()) &&
      o.toId.toLowerCase().includes(toFilter.toLowerCase()),
  );

  function isChanged(o: LaneCostOverride): boolean {
    const saved = savedByKey.get(pairKey(o.fromId, o.toId));
    return saved === undefined || saved !== o.cost;
  }

  function updateCost(fromId: string, toId: string, raw: string) {
    const key = pairKey(fromId, toId);
    setDrafts(prev => ({ ...prev, [key]: raw }));
    const parsed = parseFloat(raw);
    if (!Number.isFinite(parsed) || parsed <= 0) return;
    onChange(
      laneCostOverrides.map(o => (o.fromId === fromId && o.toId === toId ? { ...o, cost: parsed } : o)),
    );
  }

  function removeRow(fromId: string, toId: string) {
    onChange(laneCostOverrides.filter(o => !(o.fromId === fromId && o.toId === toId)));
  }

  function handleAddRow() {
    const fromId = newFrom.trim();
    const toId = newTo.trim();
    const cost = parseFloat(newCost);

    if (!fromId || !toId) {
      setAddError("From ID and To ID are both required.");
      return;
    }
    if (!Number.isFinite(cost) || cost <= 0) {
      setAddError("Cost must be a positive number.");
      return;
    }
    if (laneCostOverrides.some(o => o.fromId === fromId && o.toId === toId)) {
      setAddError("A lane cost override for this pair already exists — edit it in the table instead.");
      return;
    }

    setAddError(null);
    onChange([...laneCostOverrides, { fromId, toId, cost }]);
    setNewFrom("");
    setNewTo("");
    setNewCost("");
    setAddingRow(false);
  }

  function cancelAddRow() {
    setAddingRow(false);
    setNewFrom("");
    setNewTo("");
    setNewCost("");
    setAddError(null);
  }

  const toolbar = (
    <div className="flex items-center gap-1.5 mb-2 flex-wrap" data-testid="lanecosts-tab-toolbar">
      <Button
        variant="outline"
        size="sm"
        onClick={() => scenarioId != null && downloadEntityExport(scenarioId, "laneCosts", "csv")}
        disabled={scenarioId == null}
        data-testid="button-export-lanecosts-csv"
        className="h-7 text-xs"
      >
        <Download className="w-3.5 h-3.5 mr-1" /> CSV
      </Button>
      <Button
        variant="outline"
        size="sm"
        onClick={() => scenarioId != null && downloadEntityExport(scenarioId, "laneCosts", "json")}
        disabled={scenarioId == null}
        data-testid="button-export-lanecosts-json"
        className="h-7 text-xs"
      >
        <Download className="w-3.5 h-3.5 mr-1" /> JSON
      </Button>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setImportOpen(true)}
        disabled={scenarioId == null}
        data-testid="button-import-lanecosts"
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

  const importDialog = importOpen && scenarioId != null && (
    <ImportDialog
      open={importOpen}
      onOpenChange={setImportOpen}
      scenarioId={scenarioId}
      entity="laneCosts"
      onApplied={onImportApplied}
    />
  );

  const addRowUi = addingRow ? (
    <div className="flex items-start gap-1.5 mt-2" data-testid="add-lanecost-row-form">
      <Input
        placeholder="From ID (mine)"
        value={newFrom}
        onChange={e => setNewFrom(e.target.value)}
        className="h-7 text-xs w-36"
        data-testid="input-new-lanecost-from"
      />
      <Input
        placeholder="To ID (station)"
        value={newTo}
        onChange={e => setNewTo(e.target.value)}
        className="h-7 text-xs w-36"
        data-testid="input-new-lanecost-to"
      />
      <Input
        type="number"
        placeholder="Cost"
        value={newCost}
        onChange={e => setNewCost(e.target.value)}
        className="h-7 text-xs w-24"
        data-testid="input-new-lanecost-value"
      />
      <Button size="sm" className="h-7 px-2 text-xs" onClick={handleAddRow} data-testid="button-add-lanecost-confirm">
        Add
      </Button>
      <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={cancelAddRow} data-testid="button-add-lanecost-cancel">
        Cancel
      </Button>
    </div>
  ) : (
    <Button
      size="sm"
      variant="outline"
      className="h-7 px-2 text-xs mt-2"
      onClick={() => setAddingRow(true)}
      data-testid="button-add-lanecost-row"
    >
      + Add row
    </Button>
  );

  return (
    <div data-testid="lanecosts-tab">
      {toolbar}

      {laneCostOverrides.length === 0 ? (
        <p className="text-sm text-muted-foreground" data-testid="lanecosts-tab-empty">
          No lane cost overrides yet — add one below, or upload a CSV/JSON file.
        </p>
      ) : (
        <div className="max-h-[55vh] overflow-y-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>From (mine)</TableHead>
                <TableHead>To (station)</TableHead>
                <TableHead>Cost</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleRows.map(o => {
                const key = pairKey(o.fromId, o.toId);
                const changed = isChanged(o);
                const fromUnknown = !mineIdSet.has(o.fromId);
                const toUnknown = !stationIdSet.has(o.toId);
                return (
                  <TableRow
                    key={key}
                    data-testid={`row-lanecost-${o.fromId}-${o.toId}`}
                    className={changed ? "bg-amber-50" : undefined}
                  >
                    <TableCell className="font-mono text-xs">
                      <div className="flex items-center gap-1">
                        {o.fromId}
                        {fromUnknown && (
                          <span
                            title="Unknown mine ID — not found in this scenario's mines"
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
                            title="Unknown station ID — not found in this scenario's stations"
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
                          value={drafts[key] ?? String(o.cost)}
                          onChange={e => updateCost(o.fromId, o.toId, e.target.value)}
                          className="h-7 text-xs w-24"
                          data-testid={`input-lanecost-${o.fromId}-${o.toId}`}
                        />
                        {changed && (
                          <span
                            className="text-[10px] text-amber-700 bg-amber-100 border border-amber-300 rounded px-1"
                            data-testid={`badge-lanecost-changed-${o.fromId}-${o.toId}`}
                          >
                            Changed
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <button
                        type="button"
                        aria-label={`Remove lane cost override ${o.fromId} → ${o.toId}`}
                        onClick={() => removeRow(o.fromId, o.toId)}
                        data-testid={`button-remove-lanecost-${o.fromId}-${o.toId}`}
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
        <p className="text-[11px] text-destructive mt-1" data-testid="text-add-lanecost-error">
          {addError}
        </p>
      )}

      {importDialog}
    </div>
  );
}
