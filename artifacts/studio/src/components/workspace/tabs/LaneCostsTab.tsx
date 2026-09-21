import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Download, Upload, X } from "lucide-react";
import type { Scenario } from "@workspace/api-client-react";
import type { CanonicalUnit } from "@workspace/units";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ImportDialog } from "@/components/ImportDialog";
import { useExport } from "@/contexts/ExportContext";
import { EntityIdCell } from "@/components/tables/EntityIdCell";
import { useDisplayUnit } from "@/contexts/UnitContext";
import { useDistanceDraft } from "@/hooks/useDistanceDraft";

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
  /** Phase 3.2, Task 4 — when set, scroll/highlight the row(s) referencing this entity id (the post-Save precheck toast's "jump to it" action). Cleared by the consumer after use — this component doesn't clear it itself. */
  focusEntityId?: string | null;
  /** Followup — scenario-local added entities' `id -> displayCode` map (Workspace.tsx builds this from addedMines/addedStations). From/To cells look up through this for DISPLAY ONLY — the underlying stored fromId/toId (the uuid) stays the join key everywhere else. Base dataset ids have no entry here and fall back to showing the raw id, unchanged. */
  displayCodeById?: Record<string, string>;
  /** T11 (workspace-fixups-2, item 2) — canonical id -> {city, state,
   * displayId} (base dataset ∪ scenario-local added entities), built by
   * Workspace.tsx's `buildEntityIdentityById(modelId, dataset, localInputs)`
   * (the LIVE draft — this is an INPUT tab). This table was previously
   * BARE-ID ONLY — upgrades to the stacked City/State + mono display-id cell
   * (matching Open WHs) once the unfiltered row count exceeds 10 AND this
   * map is present; unset (every pre-INT caller) is byte-unchanged. */
  identityById?: Record<string, { city: string; state: string; displayId: string }>;
  /** chen-bands-units, Task 12 — the active model's canonical distance unit.
   * `laneCostOverrides.cost` values ARE distances in miles
   * (`transportLp.ts:18-25`: named `cost` for transport-coal's own chapter
   * vocabulary only — the objective is literally distance × flow) — they
   * convert exactly like every other distance field in this bundle, despite
   * carrying no unit label anywhere in the pre-existing UI and no "mi"/"km"
   * string anywhere in this file for a unit-literal grep to find. `null`/
   * undefined while unresolved — no fallback (Part D). Wired by
   * Workspace.tsx (Task 14). */
  canonicalUnit?: CanonicalUnit | null;
}

function pairKey(fromId: string, toId: string): string {
  return `${fromId}|${toId}`;
}

// chen-bands-units, Task 12 — one row's Cost cell. Dedicated child component
// for the same Rules-of-Hooks reason as the sibling tabs' own per-row cells.
// `cost` here is semantically a DISTANCE (see the prop comment above) — it
// routes through the identical `useDistanceDraft` contract as every other
// tab's distance field, not a special-cased "it's just a cost" path.
function LaneCostValueCell({
  canonicalUnit,
  currentValue,
  resetKey,
  onCommitValid,
  inputTestId,
}: {
  canonicalUnit: CanonicalUnit | null;
  currentValue: number;
  resetKey: unknown;
  onCommitValid: (canonicalValue: number) => void;
  inputTestId: string;
}) {
  const draft = useDistanceDraft({
    canonicalUnit,
    value: currentValue,
    resetKey,
    onCommit: v => {
      if (Number.isFinite(v) && v > 0) onCommitValid(v);
    },
  });
  return (
    <Input
      type="text"
      inputMode="decimal"
      min={0}
      value={draft.text}
      disabled={draft.disabled}
      onChange={e => draft.onChange(e.target.value)}
      onBlur={draft.commit}
      onKeyDown={e => {
        if (e.key === "Enter") draft.commit();
        else if (e.key === "Escape") draft.discard();
      }}
      className="h-7 text-xs w-24 font-mono"
      data-testid={inputTestId}
    />
  );
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
  focusEntityId,
  displayCodeById,
  identityById,
  canonicalUnit = null,
}: LaneCostsTabProps) {
  const [fromFilter, setFromFilter] = useState("");
  const [toFilter, setToFilter] = useState("");
  const [importOpen, setImportOpen] = useState(false);
  const { download, disabledReasonFor } = useExport();
  const [addingRow, setAddingRow] = useState(false);
  const [newFrom, setNewFrom] = useState("");
  const [newTo, setNewTo] = useState("");
  const [addError, setAddError] = useState<string | null>(null);

  // chen-bands-units, Task 12 — display-unit label + the add-row Cost
  // field's own draft. Mirrors DistancesTab/LegDistancesTab's identical
  // pattern exactly — `cost` here IS a distance (see the prop comment on
  // `canonicalUnit` above), so it gets the same treatment, not a lesser one.
  const { effectiveUnit } = useDisplayUnit();
  const unit = canonicalUnit == null ? null : effectiveUnit(canonicalUnit);
  const unitSuffix = (label: string) => (unit ? `${label} (${unit})` : label);
  const newCostCanonicalRef = useRef<number | null>(null);
  const newCostDraft = useDistanceDraft({
    canonicalUnit,
    value: 0,
    resetKey: scenarioId,
    onCommit: v => {
      newCostCanonicalRef.current = v;
    },
  });
  const newCostText = newCostDraft.isDirty ? newCostDraft.text : "";

  // Phase 3.2, Task 4 — post-Save precheck toast's "jump to it" action.
  // Reuses this component's own existing `row-lanecost-${fromId}-${toId}`
  // testid pattern, matched by boundary (either id can itself contain
  // hyphens, so this isn't a naive split on "-").
  useEffect(() => {
    if (!focusEntityId) return;
    const prefix = "row-lanecost-";
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
  const stationIdSet = new Set(stationIds);
  const savedByKey = new Map(savedLaneCostOverrides.map(o => [pairKey(o.fromId, o.toId), o.cost]));

  const visibleRows = laneCostOverrides.filter(
    o =>
      o.fromId.toLowerCase().includes(fromFilter.toLowerCase()) &&
      o.toId.toLowerCase().includes(toFilter.toLowerCase()),
  );

  // T11 (workspace-fixups-2, item 2) — compatibility resolver: prefer
  // `identityById`, else no location at all (this table had no prior
  // location source — the entire display was bare `displayCodeById?.[id] ??
  // id`). The `>10` UPGRADE rule gates on the UNFILTERED row count
  // (`laneCostOverrides.length`, not `visibleRows.length`).
  function resolvedLocation(id: string): { city: string; state: string } | undefined {
    if (identityById && laneCostOverrides.length > 10) {
      const entry = identityById[id];
      if (entry && (entry.city || entry.state)) return { city: entry.city, state: entry.state };
    }
    return undefined;
  }
  function resolvedDisplayId(id: string): string {
    return identityById?.[id]?.displayId ?? displayCodeById?.[id] ?? id;
  }

  function isChanged(o: LaneCostOverride): boolean {
    const saved = savedByKey.get(pairKey(o.fromId, o.toId));
    return saved === undefined || saved !== o.cost;
  }

  // chen-bands-units, Task 12 — commit-to-parent logic invoked from
  // `LaneCostValueCell`'s `onCommitValid` (fires only for a grammar-complete,
  // positive CANONICAL value on blur/Enter — `cost` converts exactly like
  // every other distance field, see the `canonicalUnit` prop comment above).
  function commitCost(fromId: string, toId: string, canonicalValue: number) {
    onChange(
      laneCostOverrides.map(o => (o.fromId === fromId && o.toId === toId ? { ...o, cost: canonicalValue } : o)),
    );
  }

  function removeRow(fromId: string, toId: string) {
    onChange(laneCostOverrides.filter(o => !(o.fromId === fromId && o.toId === toId)));
  }

  function handleAddRow() {
    const fromId = newFrom.trim();
    const toId = newTo.trim();
    // Resolve any pending typed value synchronously — see DistancesTab's
    // identical pattern/comment.
    newCostDraft.commit();
    const cost = newCostCanonicalRef.current;

    if (!fromId || !toId) {
      setAddError("From ID and To ID are both required.");
      return;
    }
    if (cost == null || !Number.isFinite(cost) || cost <= 0) {
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
    newCostDraft.discard();
    newCostCanonicalRef.current = null;
    setAddingRow(false);
  }

  function cancelAddRow() {
    setAddingRow(false);
    setNewFrom("");
    setNewTo("");
    newCostDraft.discard();
    newCostCanonicalRef.current = null;
    setAddError(null);
  }

  const toolbar = (
    <div className="flex items-center gap-1.5 mb-2 flex-wrap" data-testid="lanecosts-tab-toolbar">
      <Button
        variant="outline"
        size="sm"
        onClick={() => download("laneCosts", "csv")}
        disabled={disabledReasonFor("laneCosts") != null}
        title={disabledReasonFor("laneCosts")}
        data-testid="button-export-lanecosts-csv"
        className="h-7 text-xs"
      >
        <Download className="w-3.5 h-3.5 mr-1" /> CSV
      </Button>
      <Button
        variant="outline"
        size="sm"
        onClick={() => download("laneCosts", "json")}
        disabled={disabledReasonFor("laneCosts") != null}
        title={disabledReasonFor("laneCosts")}
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
        type="text"
        inputMode="decimal"
        placeholder={unitSuffix("Cost")}
        value={newCostText}
        disabled={newCostDraft.disabled}
        onChange={e => newCostDraft.onChange(e.target.value)}
        onBlur={newCostDraft.commit}
        onKeyDown={e => {
          if (e.key === "Enter") newCostDraft.commit();
          else if (e.key === "Escape") newCostDraft.discard();
        }}
        className="h-7 text-xs w-24 font-mono"
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
                <TableHead>{unitSuffix("Cost")}</TableHead>
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
                    <TableCell className="text-xs">
                      <div className="flex items-center gap-1">
                        <EntityIdCell entityId={o.fromId} displayId={resolvedDisplayId(o.fromId)} location={resolvedLocation(o.fromId)} />
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
                    <TableCell className="text-xs">
                      <div className="flex items-center gap-1">
                        <EntityIdCell entityId={o.toId} displayId={resolvedDisplayId(o.toId)} location={resolvedLocation(o.toId)} />
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
                        <LaneCostValueCell
                          canonicalUnit={canonicalUnit}
                          currentValue={o.cost}
                          resetKey={scenarioId}
                          onCommitValid={v => commitCost(o.fromId, o.toId, v)}
                          inputTestId={`input-lanecost-${o.fromId}-${o.toId}`}
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
