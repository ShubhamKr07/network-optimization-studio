import { useRef, useState } from "react";
import { AlertTriangle } from "lucide-react";
import type { Scenario } from "@workspace/api-client-react";
import type { CanonicalUnit } from "@workspace/units";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/data-table/DataTable";
import type { ColumnDef } from "@/components/data-table/types";
import { DeleteRowButton, DistanceValueCell, READ_ONLY_TITLE } from "@/components/data-table/entityCells";
import { useDistanceDraft } from "@/hooks/useDistanceDraft";
import { useEntityFileMenus } from "@/components/data-table/useEntityFileMenus";
import { EntityIdCell } from "@/components/tables/EntityIdCell";
import { useDisplayUnit } from "@/contexts/UnitContext";

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
  /** SCU-2.P4.6 (D2) — browsing result history: cost cells, remove buttons
   * and the add-row trigger are disabled. */
  readOnly?: boolean;
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
// SCU-2.P4.6 (B2.1/B2.2) — rendered by the shared DataTable (FilterMenu
// replaces the From/To boxes, pager above 50, numbers centred, D2).
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
  readOnly = false,
}: LaneCostsTabProps) {
  const files = useEntityFileMenus({
    entity: "laneCosts",
    testIdEntity: "lanecosts",
    modelId: "transport-coal",
    scenarioId,
    onImportApplied,
  });
  const [addingRow, setAddingRow] = useState(false);
  const [newFrom, setNewFrom] = useState("");
  const [newTo, setNewTo] = useState("");
  const [addError, setAddError] = useState<string | null>(null);

  const { effectiveUnit, toDisplay, pref } = useDisplayUnit();
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

  const mineIdSet = new Set(mineIds);
  const stationIdSet = new Set(stationIds);
  const savedByKey = new Map(savedLaneCostOverrides.map(o => [pairKey(o.fromId, o.toId), o.cost]));

  // T11 (workspace-fixups-2, item 2) — `identityById` upgrade above 10 rows (unchanged).
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

  function commitCost(fromId: string, toId: string, canonicalValue: number) {
    onChange(laneCostOverrides.map(o => (o.fromId === fromId && o.toId === toId ? { ...o, cost: canonicalValue } : o)));
  }

  function removeRow(fromId: string, toId: string) {
    onChange(laneCostOverrides.filter(o => !(o.fromId === fromId && o.toId === toId)));
  }

  function handleAddRow() {
    const fromId = newFrom.trim();
    const toId = newTo.trim();
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

  // Rebuilt every render: cells close over live props (see DistancesTab).
  const columns: ColumnDef<LaneCostOverride>[] = [
    {
      id: "from",
      header: "From (mine)",
      filterLabel: "From",
      kind: "text",
      filter: "text",
      value: o => resolvedDisplayId(o.fromId),
      cellClassName: "text-xs",
      cell: o => (
        <div className="flex items-center gap-1">
          <EntityIdCell entityId={o.fromId} displayId={resolvedDisplayId(o.fromId)} location={resolvedLocation(o.fromId)} />
          {!mineIdSet.has(o.fromId) && (
            <span
              title="Unknown mine ID — not found in this scenario's mines"
              data-testid={`warning-unknown-from-${o.fromId}-${o.toId}`}
            >
              <AlertTriangle className="w-3 h-3 text-amber-600" />
            </span>
          )}
        </div>
      ),
    },
    {
      id: "to",
      header: "To (station)",
      filterLabel: "To",
      kind: "text",
      filter: "text",
      value: o => resolvedDisplayId(o.toId),
      cellClassName: "text-xs",
      cell: o => (
        <div className="flex items-center gap-1">
          <EntityIdCell entityId={o.toId} displayId={resolvedDisplayId(o.toId)} location={resolvedLocation(o.toId)} />
          {!stationIdSet.has(o.toId) && (
            <span
              title="Unknown station ID — not found in this scenario's stations"
              data-testid={`warning-unknown-to-${o.fromId}-${o.toId}`}
            >
              <AlertTriangle className="w-3 h-3 text-amber-600" />
            </span>
          )}
        </div>
      ),
    },
    {
      id: "cost",
      header: unitSuffix("Cost"),
      filterLabel: "Cost",
      kind: "number",
      filterResetKey: pref,
      value: o => (canonicalUnit == null ? null : toDisplay(o.cost, canonicalUnit)),
      cell: o => (
        <div className="flex items-center justify-center gap-1.5">
          <DistanceValueCell
            canonicalUnit={canonicalUnit}
            currentValue={o.cost}
            resetKey={scenarioId}
            onCommitValid={v => commitCost(o.fromId, o.toId, v)}
            inputTestId={`input-lanecost-${o.fromId}-${o.toId}`}
            readOnly={readOnly}
          />
          {isChanged(o) && (
            <span
              className="text-[10px] text-amber-700 bg-amber-100 border border-amber-300 rounded px-1"
              data-testid={`badge-lanecost-changed-${o.fromId}-${o.toId}`}
            >
              Changed
            </span>
          )}
        </div>
      ),
    },
    {
      id: "remove",
      header: "",
      sortable: false,
      kind: "text",
      filter: false,
      value: () => null,
      cell: o => (
        <DeleteRowButton label={`Remove lane cost override ${o.fromId} → ${o.toId}`} onClick={() => removeRow(o.fromId, o.toId)} disabled={readOnly} testId={`button-remove-lanecost-${o.fromId}-${o.toId}`} />
      ),
    },
  ];

  const addRowUi = addingRow ? (
    <div className="flex items-start gap-1.5 mt-2" data-testid="add-lanecost-row-form">
      <Input
        placeholder="From ID (mine)"
        value={newFrom}
        onChange={e => setNewFrom(e.target.value)}
        className="h-7 text-xs w-36"
        disabled={readOnly}
        title={readOnly ? READ_ONLY_TITLE : undefined}
        data-testid="input-new-lanecost-from"
      />
      <Input
        placeholder="To ID (station)"
        value={newTo}
        onChange={e => setNewTo(e.target.value)}
        className="h-7 text-xs w-36"
        disabled={readOnly}
        title={readOnly ? READ_ONLY_TITLE : undefined}
        data-testid="input-new-lanecost-to"
      />
      <Input
        type="text"
        inputMode="decimal"
        placeholder={unitSuffix("Cost")}
        value={newCostText}
        disabled={readOnly || newCostDraft.disabled}
        title={readOnly ? READ_ONLY_TITLE : undefined}
        onChange={e => newCostDraft.onChange(e.target.value)}
        onBlur={newCostDraft.commit}
        onKeyDown={e => {
          if (e.key === "Enter") newCostDraft.commit();
          else if (e.key === "Escape") newCostDraft.discard();
        }}
        className="h-7 text-xs w-24 font-mono"
        data-testid="input-new-lanecost-value"
      />
      <Button
        size="sm"
        className="h-7 px-2 text-xs"
        onClick={handleAddRow}
        disabled={readOnly}
        title={readOnly ? READ_ONLY_TITLE : undefined}
        data-testid="button-add-lanecost-confirm"
      >
        Add
      </Button>
      <Button
        size="sm"
        variant="ghost"
        className="h-7 px-2 text-xs"
        onClick={cancelAddRow}
        data-testid="button-add-lanecost-cancel"
      >
        Cancel
      </Button>
    </div>
  ) : (
    <Button
      size="sm"
      variant="outline"
      className="h-7 px-2 text-xs mt-2"
      onClick={() => setAddingRow(true)}
      disabled={readOnly}
      title={readOnly ? READ_ONLY_TITLE : undefined}
      data-testid="button-add-lanecost-row"
    >
      + Add row
    </Button>
  );

  return (
    <div data-testid="lanecosts-tab">
      <DataTable<LaneCostOverride>
        rows={laneCostOverrides}
        rowKey={o => pairKey(o.fromId, o.toId)}
        columns={columns}
        rowClassName={(o) => (isChanged(o) ? "bg-amber-50" : undefined)}
        testIds={{
          toolbar: "lanecosts-tab-toolbar",
          row: o => `row-lanecost-${o.fromId}-${o.toId}`,
          pagerPrev: "button-lanecosts-prev",
          pagerNext: "button-lanecosts-next",
          pageIndicator: "lanecosts-page-indicator",
          empty: "lanecosts-tab-empty",
        }}
        toolbar={{ upload: files.upload, download: files.download }}
        scrollClassName="max-h-[55vh] overflow-y-auto"
        emptyState={
          <p className="text-sm text-muted-foreground">No lane cost overrides yet — add one below, or upload a CSV/JSON file.</p>
        }
        focus={
          focusEntityId ? { token: focusEntityId, matches: o => o.fromId === focusEntityId || o.toId === focusEntityId } : null
        }
      />
      {addRowUi}
      {addError && (
        <p className="text-[11px] text-destructive mt-1" data-testid="text-add-lanecost-error">
          {addError}
        </p>
      )}
      {files.dialog}
    </div>
  );
}
