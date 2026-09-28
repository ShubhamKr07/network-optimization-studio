import { useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";
import { useGetReferenceCosts, getGetReferenceCostsQueryKey } from "@workspace/api-client-react";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
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
//   2. No Upload/Download/Import toolbar — not part of this task's scope
//      (the reference-costs endpoint has no accompanying import/export
//      entity wiring yet).
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

const PAGE_SIZE = 50;

// One row's Cost cell — a plain controlled text input with local draft
// state, committed on blur/Enter. NOT `useDistanceDraft` (see the file
// header comment) — there is no unit to convert, so there is no grammar to
// track beyond "is this a non-negative finite number".
function CostCell({
  currentValue,
  resetKey,
  onCommitValid,
  inputTestId,
}: {
  currentValue: number | undefined;
  resetKey: unknown;
  onCommitValid: (value: number) => void;
  inputTestId: string;
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
      onChange={e => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={e => {
        if (e.key === "Enter") commit();
        else if (e.key === "Escape") setDraft(null);
      }}
      className="h-7 text-xs w-24 font-mono"
      data-testid={inputTestId}
    />
  );
}

export function DeliveryCostsTab({ laneCostOverrides, onChange, modelId }: DeliveryCostsTabProps) {
  const [fromFilter, setFromFilter] = useState("");
  const [toFilter, setToFilter] = useState("");
  const [page, setPage] = useState(1);
  const [addingRow, setAddingRow] = useState(false);
  const [newFrom, setNewFrom] = useState("");
  const [newTo, setNewTo] = useState("");
  const [newCost, setNewCost] = useState("");
  const [addError, setAddError] = useState<string | null>(null);

  // Called UNCONDITIONALLY (Rules of Hooks) — `enabled` gates the actual
  // request. `staleTime: Infinity` — the base matrix is immutable (DD-1),
  // fetched once per model per session.
  const referenceQuery = useGetReferenceCosts(modelId ?? "", {
    query: {
      enabled: Boolean(modelId),
      staleTime: Infinity,
      queryKey: getGetReferenceCostsQueryKey(modelId ?? ""),
    },
  });

  const referencePairs = useMemo(() => referenceQuery.data?.pairs ?? [], [referenceQuery.data]);

  const baseByKey = useMemo(() => new Map(referencePairs.map(p => [pairKey(p.fromId, p.toId), p.cost])), [referencePairs]);
  const overrideByKey = useMemo(
    () => new Map(laneCostOverrides.map(o => [pairKey(o.fromId, o.toId), o])),
    [laneCostOverrides],
  );

  // Overrides on a pair that ISN'T in the base matrix at all (a typo, or —
  // structurally, for architecture parity with DistancesTab — any pair the
  // base×base matrix doesn't cover). Always a tiny array in practice.
  const addedOverrides = useMemo(
    () => laneCostOverrides.filter(o => !baseByKey.has(pairKey(o.fromId, o.toId))),
    [laneCostOverrides, baseByKey],
  );

  function matchesFilter(fromId: string, toId: string): boolean {
    return fromId.toLowerCase().includes(fromFilter.toLowerCase()) && toId.toLowerCase().includes(toFilter.toLowerCase());
  }

  // Perf (10,329-row test) — filter FIRST over the raw arrays (cheap: no
  // per-row object construction, no Map lookups), THEN slice to the current
  // page, and only THEN merge in the override for those ~50 rows. Never
  // materializes a merged {base, override} object for a row that isn't on
  // the current page.
  const filteredBasePairs = useMemo(
    () => referencePairs.filter(p => matchesFilter(p.fromId, p.toId)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [referencePairs, fromFilter, toFilter],
  );
  const filteredAdded = useMemo(
    () => addedOverrides.filter(o => matchesFilter(o.fromId, o.toId)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [addedOverrides, fromFilter, toFilter],
  );

  const totalFilteredCount = filteredBasePairs.length + filteredAdded.length;
  const pageCount = Math.max(1, Math.ceil(totalFilteredCount / PAGE_SIZE));

  useEffect(() => {
    if (page > pageCount) setPage(pageCount);
  }, [page, pageCount]);

  const clampedPage = Math.min(page, pageCount);

  const pagedRows: MergedRow[] = useMemo(() => {
    const start = (clampedPage - 1) * PAGE_SIZE;
    const end = start + PAGE_SIZE;
    const rows: MergedRow[] = [];

    if (start < filteredBasePairs.length) {
      for (const p of filteredBasePairs.slice(start, Math.min(end, filteredBasePairs.length))) {
        rows.push({ fromId: p.fromId, toId: p.toId, base: p.cost, override: overrideByKey.get(pairKey(p.fromId, p.toId)) });
      }
    }
    const addedStart = Math.max(0, start - filteredBasePairs.length);
    const addedEnd = Math.max(0, end - filteredBasePairs.length);
    if (addedStart < filteredAdded.length) {
      for (const o of filteredAdded.slice(addedStart, Math.min(addedEnd, filteredAdded.length))) {
        rows.push({ fromId: o.fromId, toId: o.toId, base: null, override: o });
      }
    }
    return rows;
  }, [filteredBasePairs, filteredAdded, overrideByKey, clampedPage]);

  const isEmpty = referencePairs.length === 0 && laneCostOverrides.length === 0;
  const noFilterMatches = !isEmpty && totalFilteredCount === 0;

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

  const toolbar = (
    <div className="flex items-center gap-1.5 mb-2 flex-wrap" data-testid="delivery-costs-tab-toolbar">
      <div className="flex-1" />
      <Input
        placeholder="Filter from ID…"
        value={fromFilter}
        onChange={e => {
          setFromFilter(e.target.value);
          setPage(1);
        }}
        className="h-7 text-xs w-36"
        data-testid="input-filter-from"
      />
      <Input
        placeholder="Filter to ID…"
        value={toFilter}
        onChange={e => {
          setToFilter(e.target.value);
          setPage(1);
        }}
        className="h-7 text-xs w-36"
        data-testid="input-filter-to"
      />
    </div>
  );

  const addRowUi = addingRow ? (
    <div className="flex items-start gap-1.5 mt-2" data-testid="add-deliverycost-row-form">
      <Input
        placeholder="From ID (warehouse)"
        value={newFrom}
        onChange={e => setNewFrom(e.target.value)}
        className="h-7 text-xs w-36"
        data-testid="input-new-deliverycost-from"
      />
      <Input
        placeholder="To ID (customer)"
        value={newTo}
        onChange={e => setNewTo(e.target.value)}
        className="h-7 text-xs w-36"
        data-testid="input-new-deliverycost-to"
      />
      <Input
        type="text"
        inputMode="decimal"
        placeholder="Cost"
        value={newCost}
        onChange={e => setNewCost(e.target.value)}
        className="h-7 text-xs w-24 font-mono"
        data-testid="input-new-deliverycost-value"
      />
      <Button size="sm" className="h-7 px-2 text-xs" onClick={handleAddRow} data-testid="button-add-deliverycost-confirm">
        Add
      </Button>
      <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={cancelAddRow} data-testid="button-add-deliverycost-cancel">
        Cancel
      </Button>
    </div>
  ) : (
    <Button
      size="sm"
      variant="outline"
      className="h-7 px-2 text-xs mt-2"
      onClick={() => setAddingRow(true)}
      data-testid="button-add-deliverycost-row"
    >
      + Add row
    </Button>
  );

  const tableSection = isEmpty ? (
    <p className="text-sm text-muted-foreground" data-testid="delivery-costs-tab-empty">
      No cost data yet — add an override below.
    </p>
  ) : (
    <>
      <div className="max-h-[55vh] overflow-y-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>From</TableHead>
              <TableHead>To</TableHead>
              <TableHead>Base</TableHead>
              <TableHead>Cost</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {pagedRows.map(r => {
              const key = pairKey(r.fromId, r.toId);
              return (
                <TableRow key={key} data-testid={`row-deliverycost-${r.fromId}-${r.toId}`} className={r.override ? "bg-amber-50" : undefined}>
                  <TableCell className="text-xs font-mono">{r.fromId}</TableCell>
                  <TableCell className="text-xs font-mono">{r.toId}</TableCell>
                  <TableCell className="font-mono text-xs">{r.base == null ? "—" : r.base}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1.5">
                      <CostCell
                        currentValue={r.override?.cost}
                        resetKey={`${key}:${r.override ? "1" : "0"}`}
                        onCommitValid={v => commitOverride(r, v)}
                        inputTestId={`input-deliverycost-${r.fromId}-${r.toId}`}
                      />
                      {r.override && (
                        <span
                          className="text-[10px] text-amber-700 bg-amber-100 border border-amber-300 rounded px-1"
                          data-testid={`badge-deliverycost-overridden-${r.fromId}-${r.toId}`}
                        >
                          Overridden
                        </span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    {(r.override || r.base == null) && (
                      <button
                        type="button"
                        aria-label={`Remove cost override ${r.fromId} → ${r.toId}`}
                        onClick={() => clearOverride(r)}
                        data-testid={`button-remove-deliverycost-${r.fromId}-${r.toId}`}
                        className="text-muted-foreground hover:text-destructive"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
            {noFilterMatches && (
              <TableRow>
                <TableCell colSpan={5} className="text-xs text-muted-foreground text-center py-3">
                  No rows match the current filter.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      <div className="flex items-center justify-end gap-2 mt-1 text-xs">
        <Button
          size="sm"
          variant="outline"
          className="h-6 px-2 text-xs"
          disabled={clampedPage <= 1}
          onClick={() => setPage(p => Math.max(1, p - 1))}
          data-testid="button-delivery-costs-prev"
        >
          Prev
        </Button>
        <span className="font-mono text-[11px] text-muted-foreground" data-testid="delivery-costs-page-indicator">
          Page {clampedPage} of {pageCount}
        </span>
        <Button
          size="sm"
          variant="outline"
          className="h-6 px-2 text-xs"
          disabled={clampedPage >= pageCount}
          onClick={() => setPage(p => Math.min(pageCount, p + 1))}
          data-testid="button-delivery-costs-next"
        >
          Next
        </Button>
      </div>
    </>
  );

  return (
    <div data-testid="delivery-costs-tab">
      {toolbar}
      {tableSection}
      {addRowUi}
      {addError && (
        <p className="text-[11px] text-destructive mt-1" data-testid="text-add-deliverycost-error">
          {addError}
        </p>
      )}
    </div>
  );
}
