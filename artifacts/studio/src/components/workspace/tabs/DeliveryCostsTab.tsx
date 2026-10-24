import { useEffect, useMemo, useState } from "react";
import type { Scenario } from "@workspace/api-client-react";
import { useGetReferenceCosts, getGetReferenceCostsQueryKey } from "@workspace/api-client-react";
import { Input } from "@/components/ui/input";
import { DataTable } from "@/components/data-table/DataTable";
import type { ColumnDef } from "@/components/data-table/types";
import { DeleteRowButton, READ_ONLY_TITLE } from "@/components/data-table/entityCells";
import { useEntityFileMenus } from "@/components/data-table/useEntityFileMenus";
import { Button } from "@/components/ui/button";
import type { LaneCostOverride } from "@/components/workspace/tabs/LaneCostsTab";

// Task 11 — delivery-teaching-us's Delivery Costs tab, this model's ONLY
// editable dataset surface (spec decision 11; inputEntriesForModel's own
// comment). Modelled on DistancesTab.tsx's merged base+override
// architecture (baseByKey/overrideByKey/mergedRows, PAGE_SIZE=50,
// fromFilter/toFilter, a typed-id add row) but DELIBERATELY simpler in two
// ways this model doesn't need:
//   1. No warehouseIds/customerIds "unknown id" warning — delivery-teaching-us
//      has no add/delete-entity flow (no addedWarehouses/addedCustomers in
//      its inputs shape), so every id a student can type already resolves
//      against the fixed 33x313 base dataset or is a plain typo, not a
//      legitimate scenario-local id.
//   2. (SCU-2.P4.7 — superseded) Upload ▾ / Download ▾ now exist: the sparse
//      `deliveryCosts` import/export entity (spec B2.7, D1) landed in P2.
//
// The critical divergence from DistancesTab is semantic, not structural: a
// `cost` here is billable miles, NOT a distance — it must never round-trip
// through `useDistanceDraft` or any canonicalUnit conversion (that machinery
// exists precisely to convert between mi/km for actual distances; applying
// it to a cost value would silently corrupt it). Every cell here is a plain
// controlled number input. Validation is NON-negative (cost >= 0), not
// strictly positive — the dataset ships 33 zero-cost self-lanes (warehouse
// co-located with a customer), so 0 is legal data, not an error.

interface DeliveryCostsTabProps {
  /** The scenario's CURRENT laneCostOverrides array (localInputs draft) — no
   * fixed baseline to enumerate (mirrors DistancesTab/LaneCostsTab's own
   * reasoning): this grid shows exactly what the student has explicitly set,
   * merged against the immutable base matrix for display. */
  laneCostOverrides: LaneCostOverride[];
  onChange: (next: LaneCostOverride[]) => void;
  /** The active model's id — always "delivery-teaching-us" in practice (the
   * only model with this tab), passed through rather than hardcoded so the
   * component doesn't need a Workspace.tsx-specific import. Optional/undefined
   * while the scenario hasn't resolved yet, mirroring DistancesTab's own
   * `enabled` gate — the base query never fires without it. */
  modelId?: string;
  /** SCU-2.P4.7 (B2.3/B2.4) — Upload stays disabled until the scenario resolves. */
  scenarioId?: number;
  /** Fired after a successful import apply (Workspace refreshes its draft). */
  onImportApplied?: (scenario: Scenario) => void;
  /** SCU-2.P4.7 (D2) — browsing result history: cost cells, remove buttons and
   * the add-row trigger are disabled. */
  readOnly?: boolean;
}

function pairKey(fromId: string, toId: string): string {
  return `${fromId}|${toId}`;
}

interface MergedRow {
  fromId: string;
  toId: string;
  base: number | null;
  override?: LaneCostOverride;
}


// One row's Cost cell — a plain controlled text input with local draft
// state, committed on blur/Enter. NOT `useDistanceDraft` (see the file
// header comment) — there is no unit to convert, so there is no grammar to
// track beyond "is this a non-negative finite number".
function CostCell({
  currentValue,
  resetKey,
  onCommitValid,
  inputTestId,
  readOnly,
}: {
  currentValue: number | undefined;
  resetKey: unknown;
  onCommitValid: (value: number) => void;
  inputTestId: string;
  readOnly: boolean;
}) {
  const [draft, setDraft] = useState<string | null>(null);

  // Discard any in-progress draft when this row's identity/override
  // presence changes out from under it (scenario switch, or the trash-icon
  // clearing this exact row mid-edit) — mirrors DistanceOverrideCell's own
  // resetKey contract.
  useEffect(() => {
    setDraft(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey]);

  const text = draft ?? (currentValue == null ? "" : String(currentValue));

  function commit() {
    if (draft == null) return;
    const trimmed = draft.trim();
    if (trimmed === "") {
      setDraft(null);
      return;
    }
    const numeric = Number(trimmed);
    if (Number.isFinite(numeric) && numeric >= 0) {
      onCommitValid(numeric);
    }
    setDraft(null);
  }

  return (
    <Input
      type="text"
      inputMode="decimal"
      value={text}
      disabled={readOnly}
      title={readOnly ? READ_ONLY_TITLE : undefined}
      onChange={e => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={e => {
        if (e.key === "Enter") commit();
        else if (e.key === "Escape") setDraft(null);
      }}
      className="h-7 text-xs w-full min-w-24 font-mono text-center"
      data-testid={inputTestId}
    />
  );
}

// SCU-2.P4.7 (B2.1–B2.4, B2.7) — rendered by the shared DataTable: FilterMenu
// replaces the From/To boxes, the pager shows only above 50 filtered rows
// (it was always on), Upload ▾/Download ▾ use the sparse `deliveryCosts`
// entity, amber stays "override present", history read-only (D2).
export function DeliveryCostsTab({
  laneCostOverrides,
  onChange,
  modelId,
  scenarioId,
  onImportApplied,
  readOnly = false,
}: DeliveryCostsTabProps) {
  const files = useEntityFileMenus({
    entity: "deliveryCosts",
    testIdEntity: "deliverycosts",
    modelId,
    scenarioId,
    onImportApplied,
  });
  const [addingRow, setAddingRow] = useState(false);
  const [newFrom, setNewFrom] = useState("");
  const [newTo, setNewTo] = useState("");
  const [newCost, setNewCost] = useState("");
  const [addError, setAddError] = useState<string | null>(null);

  const referenceQuery = useGetReferenceCosts(modelId ?? "", {
    query: {
      enabled: Boolean(modelId),
      staleTime: Infinity,
      queryKey: getGetReferenceCostsQueryKey(modelId ?? ""),
    },
  });
  const referencePairs = useMemo(() => referenceQuery.data?.pairs ?? [], [referenceQuery.data]);

  const baseByKey = useMemo(() => new Map(referencePairs.map(p => [pairKey(p.fromId, p.toId), p.cost])), [referencePairs]);
  const overrideByKey = useMemo(() => new Map(laneCostOverrides.map(o => [pairKey(o.fromId, o.toId), o])), [laneCostOverrides]);

  // Effective rows (B2.2 step 1): the whole base matrix, then overrides for
  // pairs outside it — the same base-then-added order the old two-segment
  // pager sliced. Memoised: ~10k rows, and DataTable keys its page reset on
  // this array's identity.
  const rows: MergedRow[] = useMemo(
    () => [
      ...referencePairs.map(p => ({
        fromId: p.fromId,
        toId: p.toId,
        base: p.cost,
        override: overrideByKey.get(pairKey(p.fromId, p.toId)),
      })),
      ...laneCostOverrides
        .filter(o => !baseByKey.has(pairKey(o.fromId, o.toId)))
        .map(o => ({ fromId: o.fromId, toId: o.toId, base: null, override: o })),
    ],
    [referencePairs, laneCostOverrides, baseByKey, overrideByKey],
  );

  function commitOverride(r: MergedRow, cost: number) {
    const key = pairKey(r.fromId, r.toId);
    const next: LaneCostOverride = { fromId: r.fromId, toId: r.toId, cost };
    onChange(
      overrideByKey.has(key)
        ? laneCostOverrides.map(o => (pairKey(o.fromId, o.toId) === key ? next : o))
        : [...laneCostOverrides, next],
    );
  }

  function clearOverride(r: MergedRow) {
    const key = pairKey(r.fromId, r.toId);
    onChange(laneCostOverrides.filter(o => pairKey(o.fromId, o.toId) !== key));
  }

  function handleAddRow() {
    const fromId = newFrom.trim();
    const toId = newTo.trim();
    const trimmedCost = newCost.trim();

    if (!fromId || !toId) {
      setAddError("From ID and To ID are both required.");
      return;
    }
    if (referencePairs.length > 0 && !referencePairs.some(p => p.fromId === fromId)) {
      setAddError(`Unknown warehouse id "${fromId}" — not found in the base cost matrix.`);
      return;
    }
    if (referencePairs.length > 0 && !referencePairs.some(p => p.toId === toId)) {
      setAddError(`Unknown customer id "${toId}" — not found in the base cost matrix.`);
      return;
    }
    const cost = trimmedCost === "" ? NaN : Number(trimmedCost);
    if (!Number.isFinite(cost) || cost < 0) {
      setAddError("Cost must be a non-negative number.");
      return;
    }
    if (laneCostOverrides.some(o => o.fromId === fromId && o.toId === toId)) {
      setAddError("A cost override for this pair already exists — edit it in the table instead.");
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

  // Rebuilt every render: cells close over live props (see DistancesTab).
  const columns: ColumnDef<MergedRow>[] = [
    {
      id: "from",
      header: "From",
      kind: "text",
      filter: "text",
      value: r => r.fromId,
      cellClassName: "text-xs font-mono",
      cell: r => r.fromId,
    },
    {
      id: "to",
      header: "To",
      kind: "text",
      filter: "text",
      value: r => r.toId,
      cellClassName: "text-xs font-mono",
      cell: r => r.toId,
    },
    {
      id: "base",
      header: "Base",
      kind: "number",
      value: r => r.base,
      cellClassName: "font-mono text-xs",
      cell: r => (r.base == null ? "—" : r.base),
    },
    {
      id: "cost",
      header: "Cost",
      kind: "number",
      value: r => r.override?.cost ?? null,
      cell: r => (
        <div className="flex items-center justify-center gap-1.5">
          <CostCell
            currentValue={r.override?.cost}
            resetKey={`${pairKey(r.fromId, r.toId)}:${r.override ? "1" : "0"}`}
            onCommitValid={v => commitOverride(r, v)}
            inputTestId={`input-deliverycost-${r.fromId}-${r.toId}`}
            readOnly={readOnly}
          />
          {r.override && (
            <span
              className="text-2xs text-warning bg-warning-bg border border-warning-border rounded px-1"
              data-testid={`badge-deliverycost-overridden-${r.fromId}-${r.toId}`}
            >
              Overridden
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
      cell: r =>
        (r.override || r.base == null) && (
          <DeleteRowButton label={`Remove cost override ${r.fromId} → ${r.toId}`} onClick={() => clearOverride(r)} disabled={readOnly} testId={`button-remove-deliverycost-${r.fromId}-${r.toId}`} />
        ),
    },
  ];

  const addRowUi = addingRow ? (
    <div className="flex items-start gap-1.5 mt-2" data-testid="add-deliverycost-row-form">
      <Input
        placeholder="From ID (warehouse)"
        value={newFrom}
        onChange={e => setNewFrom(e.target.value)}
        className="h-7 text-xs w-36"
        disabled={readOnly}
        title={readOnly ? READ_ONLY_TITLE : undefined}
        data-testid="input-new-deliverycost-from"
      />
      <Input
        placeholder="To ID (customer)"
        value={newTo}
        onChange={e => setNewTo(e.target.value)}
        className="h-7 text-xs w-36"
        disabled={readOnly}
        title={readOnly ? READ_ONLY_TITLE : undefined}
        data-testid="input-new-deliverycost-to"
      />
      <Input
        type="text"
        inputMode="decimal"
        placeholder="Cost"
        value={newCost}
        onChange={e => setNewCost(e.target.value)}
        className="h-7 text-xs w-24 font-mono"
        disabled={readOnly}
        title={readOnly ? READ_ONLY_TITLE : undefined}
        data-testid="input-new-deliverycost-value"
      />
      <Button
        size="sm"
        className="h-7 px-2 text-xs"
        onClick={handleAddRow}
        disabled={readOnly}
        title={readOnly ? READ_ONLY_TITLE : undefined}
        data-testid="button-add-deliverycost-confirm"
      >
        Add
      </Button>
      <Button
        size="sm"
        variant="ghost"
        className="h-7 px-2 text-xs"
        onClick={cancelAddRow}
        data-testid="button-add-deliverycost-cancel"
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
      data-testid="button-add-deliverycost-row"
    >
      + Add row
    </Button>
  );

  // Loading / error / no data replace the table (toolbar stays), each with
  // its own testid — DataTable renders `emptyState` inside `testIds.empty`.
  const emptyTestId = referenceQuery.isLoading
    ? "delivery-costs-tab-loading"
    : referenceQuery.isError
      ? "delivery-costs-tab-error"
      : "delivery-costs-tab-empty";
  const emptyState = referenceQuery.isLoading ? (
    <p className="text-sm text-muted-foreground">Loading cost data…</p>
  ) : referenceQuery.isError ? (
    <p className="text-sm text-destructive">Failed to load cost data — try reloading the page.</p>
  ) : (
    <p className="text-sm text-muted-foreground">No cost data yet — add an override below.</p>
  );

  return (
    <div data-testid="delivery-costs-tab">
      <DataTable<MergedRow>
        rows={referenceQuery.isLoading || referenceQuery.isError ? [] : rows}
        rowKey={r => pairKey(r.fromId, r.toId)}
        columns={columns}
        rowClassName={(r) => (r.override != null ? "bg-warning-bg" : undefined)}
        testIds={{
          toolbar: "delivery-costs-tab-toolbar",
          row: r => `row-deliverycost-${r.fromId}-${r.toId}`,
          pagerPrev: "button-delivery-costs-prev",
          pagerNext: "button-delivery-costs-next",
          pageIndicator: "delivery-costs-page-indicator",
          empty: emptyTestId,
        }}
        toolbar={{ upload: files.upload, download: files.download }}
        scrollClassName="max-h-[55vh] overflow-y-auto"
        emptyState={emptyState}
      />
      {addRowUi}
      {addError && (
        <p className="text-[11px] text-destructive mt-1" data-testid="text-add-deliverycost-error">
          {addError}
        </p>
      )}
      {files.dialog}
    </div>
  );
}
