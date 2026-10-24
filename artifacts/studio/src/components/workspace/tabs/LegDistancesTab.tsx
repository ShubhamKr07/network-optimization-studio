import { useRef, useState } from "react";
import { AlertTriangle } from "lucide-react";
import type { Scenario } from "@workspace/api-client-react";
import type { CanonicalUnit } from "@workspace/units";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { DataTable } from "@/components/data-table/DataTable";
import type { ColumnDef } from "@/components/data-table/types";
import { DeleteRowButton, DistanceValueCell, READ_ONLY_TITLE } from "@/components/data-table/entityCells";
import { useDistanceDraft } from "@/hooks/useDistanceDraft";
import { useEntityFileMenus } from "@/components/data-table/useEntityFileMenus";
import { EntityIdCell } from "@/components/tables/EntityIdCell";
import { useDisplayUnit } from "@/contexts/UnitContext";

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
  /** Followup — scenario-local added entities' `id -> displayCode` map (Workspace.tsx builds this from addedRefineries/addedCustomers — no addedMines, the mine is fixed). From/To cells look up through this for DISPLAY ONLY — the underlying stored fromId/toId (the uuid) stays the join key everywhere else (existence checks, leg resolution, edits, removal). Base dataset ids have no entry here and fall back to showing the raw id, unchanged. */
  displayCodeById?: Record<string, string>;
  /** T11 (workspace-fixups-2, item 2/Codex P1) — canonical id -> {city,
   * state, displayId} (base dataset ∪ scenario-local added entities), built
   * by Workspace.tsx's `buildEntityIdentityById(modelId, dataset,
   * localInputs)` (the LIVE draft — this is an INPUT tab). This table was
   * previously BARE-ID ONLY (no location source at all) — user-defined rows
   * can exceed 10, so it upgrades to the stacked City/State + mono
   * display-id cell (matching Open WHs) once the unfiltered row count
   * exceeds 10 AND this map is present; unset (every pre-INT caller) is
   * byte-unchanged. */
  identityById?: Record<string, { city: string; state: string; displayId: string }>;
  /** chen-bands-units, Task 12 — the active model's canonical distance unit
   * ("km" | "mi"), sourced from the manifest. `null`/undefined while it
   * hasn't resolved yet — there is NO fallback: values/labels stay gated (no
   * number, no unit suffix, disabled input) until this is authoritative
   * (Part D, "No fallback unit"). Wired by Workspace.tsx (Task 14). */
  canonicalUnit?: CanonicalUnit | null;
  /** SCU-2.P4.4 (D2) — browsing result history: value cells, remove buttons
   * and the add-row trigger are disabled. */
  readOnly?: boolean;
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
  displayCodeById,
  identityById,
  canonicalUnit = null,
  readOnly = false,
}: LegDistancesTabProps) {
  const files = useEntityFileMenus({
    entity: "legDistances",
    testIdEntity: "legdistances",
    modelId: "two-echelon-gold-au",
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

  // The add-row Distance field — see DistancesTab's identical pattern/comment.
  const newDistanceCanonicalRef = useRef<number | null>(null);
  const newDistanceDraft = useDistanceDraft({
    canonicalUnit,
    value: 0,
    resetKey: scenarioId,
    onCommit: v => {
      newDistanceCanonicalRef.current = v;
    },
  });
  const newDistanceText = newDistanceDraft.isDirty ? newDistanceDraft.text : "";

  const mineIdSet = new Set(mineIds);
  const refineryIdSet = new Set(refineryIds);
  const customerIdSet = new Set(customerIds);
  const savedByKey = new Map(savedDistanceOverrides.map(o => [pairKey(o.fromId, o.toId), o.distance]));

  // Leg resolved purely by id-space membership — mirrors merge_inputs.py's
  // build_merged_two_echelon_dataset exactly.
  function legFor(fromId: string, toId: string): Leg {
    if (mineIdSet.has(fromId) && refineryIdSet.has(toId)) return "mine_to_refinery";
    if (refineryIdSet.has(fromId) && customerIdSet.has(toId)) return "refinery_to_customer";
    return "unknown";
  }

  // T11 (workspace-fixups-2, item 2) — `identityById` upgrade above 10 rows (unchanged).
  function resolvedLocation(id: string): { city: string; state: string } | undefined {
    if (identityById && distanceOverrides.length > 10) {
      const entry = identityById[id];
      if (entry && (entry.city || entry.state)) return { city: entry.city, state: entry.state };
    }
    return undefined;
  }
  function resolvedDisplayId(id: string): string {
    return identityById?.[id]?.displayId ?? displayCodeById?.[id] ?? id;
  }

  const LEG_LABEL: Record<Leg, string> = {
    mine_to_refinery: "Mine → Refinery",
    refinery_to_customer: "Refinery → Customer",
    unknown: "Unrecognized pair",
  };

  function isChanged(o: LegDistanceOverride): boolean {
    const saved = savedByKey.get(pairKey(o.fromId, o.toId));
    return saved === undefined || saved !== o.distance;
  }

  function commitDistance(fromId: string, toId: string, canonicalValue: number) {
    onChange(distanceOverrides.map(o => (o.fromId === fromId && o.toId === toId ? { ...o, distance: canonicalValue } : o)));
  }

  function removeRow(fromId: string, toId: string) {
    onChange(distanceOverrides.filter(o => !(o.fromId === fromId && o.toId === toId)));
  }

  function handleAddRow() {
    const fromId = newFrom.trim();
    const toId = newTo.trim();
    newDistanceDraft.commit();
    const distance = newDistanceCanonicalRef.current;

    if (!fromId || !toId) {
      setAddError("From ID and To ID are both required.");
      return;
    }
    if (distance == null || !Number.isFinite(distance) || distance <= 0) {
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
    newDistanceDraft.discard();
    newDistanceCanonicalRef.current = null;
    setAddingRow(false);
  }

  function cancelAddRow() {
    setAddingRow(false);
    setNewFrom("");
    setNewTo("");
    newDistanceDraft.discard();
    newDistanceCanonicalRef.current = null;
    setAddError(null);
  }

  // Rebuilt every render: cells close over live props (see DistancesTab).
  const columns: ColumnDef<LegDistanceOverride>[] = [
    {
      id: "leg",
      header: "Leg",
      kind: "enum",
      value: o => LEG_LABEL[legFor(o.fromId, o.toId)],
      cell: o => {
        const leg = legFor(o.fromId, o.toId);
        return (
          <Badge variant={leg === "unknown" ? "destructive" : "secondary"} data-testid={`badge-leg-${o.fromId}-${o.toId}`}>
            {leg === "unknown" && <AlertTriangle className="w-3 h-3 mr-1" />}
            {LEG_LABEL[leg]}
          </Badge>
        );
      },
    },
    {
      id: "from",
      header: "From",
      kind: "text",
      filter: "text",
      value: o => resolvedDisplayId(o.fromId),
      cellClassName: "text-xs",
      cell: o => (
        <EntityIdCell entityId={o.fromId} displayId={resolvedDisplayId(o.fromId)} location={resolvedLocation(o.fromId)} />
      ),
    },
    {
      id: "to",
      header: "To",
      kind: "text",
      filter: "text",
      value: o => resolvedDisplayId(o.toId),
      cellClassName: "text-xs",
      cell: o => <EntityIdCell entityId={o.toId} displayId={resolvedDisplayId(o.toId)} location={resolvedLocation(o.toId)} />,
    },
    {
      id: "distance",
      header: unitSuffix("Distance"),
      filterLabel: "Distance",
      kind: "number",
      filterResetKey: pref,
      value: o => (canonicalUnit == null ? null : toDisplay(o.distance, canonicalUnit)),
      cell: o => (
        <div className="flex items-center justify-center gap-1.5">
          <DistanceValueCell
            canonicalUnit={canonicalUnit}
            currentValue={o.distance}
            resetKey={scenarioId}
            onCommitValid={v => commitDistance(o.fromId, o.toId, v)}
            inputTestId={`input-legdistance-${o.fromId}-${o.toId}`}
            readOnly={readOnly}
          />
          {isChanged(o) && (
            <span
              className="text-[10px] text-warning bg-warning-bg border border-warning-border rounded px-1"
              data-testid={`badge-legdistance-changed-${o.fromId}-${o.toId}`}
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
        <DeleteRowButton label={`Remove leg distance override ${o.fromId} → ${o.toId}`} onClick={() => removeRow(o.fromId, o.toId)} disabled={readOnly} testId={`button-remove-legdistance-${o.fromId}-${o.toId}`} />
      ),
    },
  ];

  const addRowUi = addingRow ? (
    <div className="flex items-start gap-1.5 mt-2" data-testid="add-legdistance-row-form">
      <Input
        placeholder="From ID (mine or refinery)"
        value={newFrom}
        onChange={e => setNewFrom(e.target.value)}
        className="h-7 text-xs w-44"
        disabled={readOnly}
        title={readOnly ? READ_ONLY_TITLE : undefined}
        data-testid="input-new-legdistance-from"
      />
      <Input
        placeholder="To ID (refinery or customer)"
        value={newTo}
        onChange={e => setNewTo(e.target.value)}
        className="h-7 text-xs w-44"
        disabled={readOnly}
        title={readOnly ? READ_ONLY_TITLE : undefined}
        data-testid="input-new-legdistance-to"
      />
      <Input
        type="text"
        inputMode="decimal"
        placeholder={unitSuffix("Distance")}
        value={newDistanceText}
        disabled={readOnly || newDistanceDraft.disabled}
        title={readOnly ? READ_ONLY_TITLE : undefined}
        onChange={e => newDistanceDraft.onChange(e.target.value)}
        onBlur={newDistanceDraft.commit}
        onKeyDown={e => {
          if (e.key === "Enter") newDistanceDraft.commit();
          else if (e.key === "Escape") newDistanceDraft.discard();
        }}
        className="h-7 text-xs w-24 font-mono"
        data-testid="input-new-legdistance-value"
      />
      <Button
        size="sm"
        className="h-7 px-2 text-xs"
        onClick={handleAddRow}
        disabled={readOnly}
        title={readOnly ? READ_ONLY_TITLE : undefined}
        data-testid="button-add-legdistance-confirm"
      >
        Add
      </Button>
      <Button
        size="sm"
        variant="ghost"
        className="h-7 px-2 text-xs"
        onClick={cancelAddRow}
        data-testid="button-add-legdistance-cancel"
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
      data-testid="button-add-legdistance-row"
    >
      + Add row
    </Button>
  );

  return (
    <div data-testid="legdistances-tab">
      <p className="text-xs text-muted-foreground mb-2">
        One flat list covers both legs — each row is auto-labeled Mine → Refinery or Refinery → Customer based on which IDs it
        references.
      </p>
      <DataTable<LegDistanceOverride>
        rows={distanceOverrides}
        rowKey={o => pairKey(o.fromId, o.toId)}
        columns={columns}
        rowClassName={(o) => (isChanged(o) ? "bg-warning-bg" : undefined)}
        testIds={{
          toolbar: "legdistances-tab-toolbar",
          row: o => `row-legdistance-${o.fromId}-${o.toId}`,
          pagerPrev: "button-legdistances-prev",
          pagerNext: "button-legdistances-next",
          pageIndicator: "legdistances-page-indicator",
          empty: "legdistances-tab-empty",
        }}
        toolbar={{ upload: files.upload, download: files.download }}
        scrollClassName="max-h-[55vh] overflow-y-auto"
        emptyState={
          <p className="text-sm text-muted-foreground">
            No leg distance overrides yet — add one below, or upload a CSV/JSON file.
          </p>
        }
        // The precheck toast's "jump to it" (was a DOM scroll only): now also
        // clears filters and pages, like Distances (B2.2).
        focus={
          focusEntityId ? { token: focusEntityId, matches: o => o.fromId === focusEntityId || o.toId === focusEntityId } : null
        }
      />
      {addRowUi}
      {addError && (
        <p className="text-[11px] text-destructive mt-1" data-testid="text-add-legdistance-error">
          {addError}
        </p>
      )}
      {files.dialog}
    </div>
  );
}
