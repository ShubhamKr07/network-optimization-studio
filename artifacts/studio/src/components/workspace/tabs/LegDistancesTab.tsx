import { useEffect, useState } from "react";
import { AlertTriangle, Download, Upload, X } from "lucide-react";
import type { Scenario } from "@workspace/api-client-react";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ImportDialog } from "@/components/ImportDialog";
import { downloadEntityExport } from "@/lib/exportEntity";

export interface LegDistanceOverride {
  fromId: string;
  toId: string;
  distance: number;
}

type Leg = "mine_to_refinery" | "refinery_to_customer" | "unknown";

interface LegDistancesTabProps {
  /** The scenario's CURRENT distanceOverrides array (localInputs draft) —
   * same field name/shape as p-median-us's DistancesTab (a deliberate B6.2
   * stage 1 naming choice — this model's own vocabulary is unambiguously
   * "distance", not transport-coal's "cost"), but covering BOTH legs (mine
   * -> refinery and refinery -> customer) in one flat array. There's no
   * fixed baseline to enumerate (B4.3's same reasoning): this grid shows
   * exactly what the student has explicitly set. */
  distanceOverrides: LegDistanceOverride[];
  /** The last-SAVED distanceOverrides array (savedInputsRef.current, read at
   * the Workspace.tsx call site) — diffed against `distanceOverrides` purely
   * to drive the changed-row highlight. Never written to. */
  savedDistanceOverrides: LegDistanceOverride[];
  /** Known mine/refinery/customer ids (base dataset + any scenario-local
   * addedRefineries/addedCustomers — no addedMines, the mine is fixed) —
   * used for a cheap client-side existence check AND to derive each row's
   * leg-type badge. B6.2 stage 3's server-side precheck remains the
   * authoritative check the Solve flow actually gates on. */
  mineIds: string[];
  refineryIds: string[];
  customerIds: string[];
  onChange: (next: LegDistanceOverride[]) => void;
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

// B6.2 stage 4 — two-echelon-gold-au's "Leg distances" grid tab, the
// three-id-space analogue of B5.1's DistancesTab.tsx / Task 30's
// LaneCostsTab.tsx (long-format {fromId, toId, distance} grid, from/to
// filters, changed-row highlight, add-row, Upload/Download wired to the new
// legDistances backend entity). Own component, not a fork of either sibling
// tab — this model's rows span TWO structurally different legs sharing one
// flat array (verified directly against solve_two_echelon/merge_inputs.py's
// build_merged_two_echelon_dataset, not a string-prefix convention), so
// every row needs a visual cue for WHICH leg it represents — neither sibling
// tab's single from/to role pairing has anything to adapt for that.
export function LegDistancesTab({
  distanceOverrides,
  savedDistanceOverrides,
  mineIds,
  refineryIds,
  customerIds,
  onChange,
  scenarioId,
  onImportApplied,
  focusEntityId,
}: LegDistancesTabProps) {
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
  // Reuses this component's own existing `row-legdistance-${fromId}-${toId}`
  // testid pattern, matched by boundary (either id can itself contain
  // hyphens, so this isn't a naive split on "-").
  useEffect(() => {
    if (!focusEntityId) return;
    const prefix = "row-legdistance-";
    const rows = document.querySelectorAll(`[data-testid^="${prefix}"]`);
    for (const row of Array.from(rows)) {
      const testid = row.getAttribute("data-testid") ?? "";
      const suffix = testid.slice(prefix.length);
      if (suffix.startsWith(`${focusEntityId}-`) || suffix.endsWith(`-${focusEntityId}`)) {
        row.scrollIntoView({ block: "center" });
        break;
      }
    }
  }, [focusEntityId]);

  const mineIdSet = new Set(mineIds);
  const refineryIdSet = new Set(refineryIds);
  const customerIdSet = new Set(customerIds);
  const savedByKey = new Map(savedDistanceOverrides.map(o => [pairKey(o.fromId, o.toId), o.distance]));

  // Leg resolved purely by which id-space fromId/toId each belong to (never
  // a string-prefix convention) — mirrors merge_inputs.py's
  // build_merged_two_echelon_dataset exactly, so this badge reflects the
  // SAME resolution the solver/precheck actually apply, not an
  // independently-reinvented rule.
  function legFor(fromId: string, toId: string): Leg {
    if (mineIdSet.has(fromId) && refineryIdSet.has(toId)) return "mine_to_refinery";
    if (refineryIdSet.has(fromId) && customerIdSet.has(toId)) return "refinery_to_customer";
    return "unknown";
  }

  const LEG_LABEL: Record<Leg, string> = {
    mine_to_refinery: "Mine → Refinery",
    refinery_to_customer: "Refinery → Customer",
    unknown: "Unrecognized pair",
  };

  const visibleRows = distanceOverrides.filter(
    o =>
      o.fromId.toLowerCase().includes(fromFilter.toLowerCase()) &&
      o.toId.toLowerCase().includes(toFilter.toLowerCase()),
  );

  function isChanged(o: LegDistanceOverride): boolean {
    const saved = savedByKey.get(pairKey(o.fromId, o.toId));
    return saved === undefined || saved !== o.distance;
  }

  function updateDistance(fromId: string, toId: string, raw: string) {
    const key = pairKey(fromId, toId);
    setDrafts(prev => ({ ...prev, [key]: raw }));
    const parsed = parseFloat(raw);
    if (!Number.isFinite(parsed) || parsed <= 0) return;
    onChange(
      distanceOverrides.map(o => (o.fromId === fromId && o.toId === toId ? { ...o, distance: parsed } : o)),
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
    if (legFor(fromId, toId) === "unknown") {
      setAddError("This pair doesn't resolve as a mine→refinery leg or a refinery→customer leg — check the IDs.");
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
    <div className="flex items-center gap-1.5 mb-2 flex-wrap" data-testid="legdistances-tab-toolbar">
      <Button
        variant="outline"
        size="sm"
        onClick={() => scenarioId != null && downloadEntityExport(scenarioId, "legDistances", "csv")}
        disabled={scenarioId == null}
        data-testid="button-export-legdistances-csv"
        className="h-7 text-xs"
      >
        <Download className="w-3.5 h-3.5 mr-1" /> CSV
      </Button>
      <Button
        variant="outline"
        size="sm"
        onClick={() => scenarioId != null && downloadEntityExport(scenarioId, "legDistances", "json")}
        disabled={scenarioId == null}
        data-testid="button-export-legdistances-json"
        className="h-7 text-xs"
      >
        <Download className="w-3.5 h-3.5 mr-1" /> JSON
      </Button>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setImportOpen(true)}
        disabled={scenarioId == null}
        data-testid="button-import-legdistances"
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
      entity="legDistances"
      onApplied={onImportApplied}
    />
  );

  const addRowUi = addingRow ? (
    <div className="flex items-start gap-1.5 mt-2" data-testid="add-legdistance-row-form">
      <Input
        placeholder="From ID (mine or refinery)"
        value={newFrom}
        onChange={e => setNewFrom(e.target.value)}
        className="h-7 text-xs w-44"
        data-testid="input-new-legdistance-from"
      />
      <Input
        placeholder="To ID (refinery or customer)"
        value={newTo}
        onChange={e => setNewTo(e.target.value)}
        className="h-7 text-xs w-44"
        data-testid="input-new-legdistance-to"
      />
      <Input
        type="number"
        placeholder="Distance"
        value={newDistance}
        onChange={e => setNewDistance(e.target.value)}
        className="h-7 text-xs w-24"
        data-testid="input-new-legdistance-value"
      />
      <Button size="sm" className="h-7 px-2 text-xs" onClick={handleAddRow} data-testid="button-add-legdistance-confirm">
        Add
      </Button>
      <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={cancelAddRow} data-testid="button-add-legdistance-cancel">
        Cancel
      </Button>
    </div>
  ) : (
    <Button
      size="sm"
      variant="outline"
      className="h-7 px-2 text-xs mt-2"
      onClick={() => setAddingRow(true)}
      data-testid="button-add-legdistance-row"
    >
      + Add row
    </Button>
  );

  return (
    <div data-testid="legdistances-tab">
      <p className="text-xs text-muted-foreground mb-2">
        One flat list covers both legs — each row is auto-labeled Mine → Refinery or Refinery → Customer based on which IDs it references.
      </p>
      {toolbar}

      {distanceOverrides.length === 0 ? (
        <p className="text-sm text-muted-foreground" data-testid="legdistances-tab-empty">
          No leg distance overrides yet — add one below, or upload a CSV/JSON file.
        </p>
      ) : (
        <div className="max-h-[55vh] overflow-y-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Leg</TableHead>
                <TableHead>From</TableHead>
                <TableHead>To</TableHead>
                <TableHead>Distance</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleRows.map(o => {
                const key = pairKey(o.fromId, o.toId);
                const changed = isChanged(o);
                const leg = legFor(o.fromId, o.toId);
                return (
                  <TableRow
                    key={key}
                    data-testid={`row-legdistance-${o.fromId}-${o.toId}`}
                    className={changed ? "bg-amber-50" : undefined}
                  >
                    <TableCell>
                      <Badge
                        variant={leg === "unknown" ? "destructive" : "secondary"}
                        data-testid={`badge-leg-${o.fromId}-${o.toId}`}
                      >
                        {leg === "unknown" && <AlertTriangle className="w-3 h-3 mr-1" />}
                        {LEG_LABEL[leg]}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-mono text-xs">{o.fromId}</TableCell>
                    <TableCell className="font-mono text-xs">{o.toId}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5">
                        <Input
                          type="number"
                          min={0}
                          value={drafts[key] ?? String(o.distance)}
                          onChange={e => updateDistance(o.fromId, o.toId, e.target.value)}
                          className="h-7 text-xs w-24"
                          data-testid={`input-legdistance-${o.fromId}-${o.toId}`}
                        />
                        {changed && (
                          <span
                            className="text-[10px] text-amber-700 bg-amber-100 border border-amber-300 rounded px-1"
                            data-testid={`badge-legdistance-changed-${o.fromId}-${o.toId}`}
                          >
                            Changed
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <button
                        type="button"
                        aria-label={`Remove leg distance override ${o.fromId} → ${o.toId}`}
                        onClick={() => removeRow(o.fromId, o.toId)}
                        data-testid={`button-remove-legdistance-${o.fromId}-${o.toId}`}
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
                  <TableCell colSpan={5} className="text-xs text-muted-foreground text-center py-3">
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
        <p className="text-[11px] text-destructive mt-1" data-testid="text-add-legdistance-error">
          {addError}
        </p>
      )}

      {importDialog}
    </div>
  );
}
