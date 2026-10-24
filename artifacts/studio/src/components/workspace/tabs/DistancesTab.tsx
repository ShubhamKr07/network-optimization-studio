import { useMemo, useRef, useState } from "react";
import { AlertTriangle } from "lucide-react";
import type { Scenario } from "@workspace/api-client-react";
import { useGetReferenceDistances, getGetReferenceDistancesQueryKey } from "@workspace/api-client-react";
import type { CanonicalUnit } from "@workspace/units";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { DataTable } from "@/components/data-table/DataTable";
import type { ColumnDef } from "@/components/data-table/types";
import { DeleteRowButton, READ_ONLY_TITLE } from "@/components/data-table/entityCells";
import { useEntityFileMenus } from "@/components/data-table/useEntityFileMenus";
import { EntityIdCell } from "@/components/tables/EntityIdCell";
import { useDisplayUnit } from "@/contexts/UnitContext";
import { useDistanceDraft } from "@/hooks/useDistanceDraft";
import { formatDistanceDisplay, stripGrouping } from "@/lib/formatDistanceDisplay";

export interface DistanceOverride {
  fromId: string;
  toId: string;
  distance: number;
  /** T1 (Input Map v2) — true when this row was auto-filled by the backend's
   * haversine normalizer (services/autoDistance.ts) rather than entered or
   * imported by the student. Matches distanceOverrideSchema's own optional
   * `estimated` field exactly. Purely a display flag — editing the distance
   * (see `commitOverride`) drops it, treating the edit as a confirmation. */
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
   * matrix. Optional: absent (or `referenceCapable` false) means there is no
   * base×base matrix at all — the merged table becomes override-rows-only. */
  modelId?: string;
  /** B3 — mirrors `manifest.capabilities.supportsReferenceDistances` for the
   * active model. The reference fetch only fires when this is true AND
   * `modelId` is set — an unsupported model (e.g. Brazil) must never issue
   * the request (would 422 server-side). */
  referenceCapable?: boolean;
  /** B3 — base-dataset warehouse ids currently INACTIVE in the scenario's live
   * (unsaved) `localInputs` draft (status not potential/fixed-open). Purely a
   * view filter over the immutable reference matrix — never refetched, just
   * hides rows whose warehouse endpoint is presently inactive (unless the
   * pair carries a current or saved override — resolution #2/#3). */
  inactiveWarehouseIds?: string[];
  /** B3 — base-dataset customer ids currently EXCLUDED in the scenario's live
   * `localInputs` draft. Same filter semantics as `inactiveWarehouseIds`. */
  excludedCustomerIds?: string[];
  /** ch4-tab-city-labels — max-coverage-us-only — id -> {city, state}
   * (base dataset ∪ added entities), built by Workspace.tsx's
   * `chenLocationMapFromInputs` off the same `localInputs` draft this tab's
   * other props already read. Originally written when this model was
   * chens-cosmetics-cn's China dataset, where `state` was "" for every row
   * (formatCityState() rendered city-only, never a trailing ", "); the
   * US dataset swap (MIG-4) gives every row a real state, so this now
   * renders "City, ST" — formatCityState()'s blank-state fallback stays
   * only as a defensive no-op, not because any shipped row is blank. When
   * present, the From/To cells show the city as the primary label with the
   * id/displayCode as a mono sub-label (mirrors JadeDistancesTab.tsx).
   * Absent for every other model (undefined) -> unchanged id-only
   * rendering (Bundle 6.1 resolution #5's original "no city column"
   * design stays intact for p-median-us/brazil). */
  locationById?: Record<string, { city: string; state: string }>;
  /** T11 (workspace-fixups-2, item 2) — canonical id -> {city, state,
   * displayId} (base dataset ∪ scenario-local added entities), built by
   * Workspace.tsx's `buildEntityIdentityById(modelId, dataset, localInputs)`
   * — the LIVE draft, not the solved snapshot (an entity added/moved in the
   * current unsaved draft must show correct location + code immediately).
   * COMPATIBILITY RESOLVER: a cell prefers this map's entry, else falls back
   * to the existing `locationById`/`displayCodeById` sources, else the
   * canonical id — so leaving this prop unset (every pre-INT caller) is
   * byte-unchanged. The location-cell UPGRADE this map newly enables for a
   * currently bare-id pair (p-median-us/brazil, which never had
   * `locationById`) is additionally gated on the unfiltered row count
   * exceeding 10 (item 2's ">10 upgrade" rule) — Chen's existing
   * `locationById`-driven display already renders rich at every row count
   * and is never gated by this threshold. */
  identityById?: Record<string, { city: string; state: string; displayId: string }>;
  /** chen-bands-units, Task 12 — the active model's canonical distance unit
   * ("km" | "mi"), sourced from the manifest. `null`/undefined while it
   * hasn't resolved yet — there is NO fallback: every value/label below and
   * every editable cell stays gated (no number, no unit suffix, disabled
   * input) until this is authoritative (Part D, "No fallback unit"). Wired
   * by Workspace.tsx (Task 14); every pre-Task-14 caller omits it, which is
   * exactly the disabled/unresolved state, not a behavior regression for
   * those callers since none of them previously carried unit awareness. */
  canonicalUnit?: CanonicalUnit | null;
  /** SCU-2.P4.3 (D2) — browsing result history: every override cell, remove
   * button and the add-row trigger are disabled (the write was silently
   * dropped by Workspace's `updateInputsField` before). */
  readOnly?: boolean;
}

function pairKey(fromId: string, toId: string): string {
  return `${fromId}|${toId}`;
}

// chen-bands-units, Task 12 — one row's Override cell. A dedicated child
// component (not a hook called inline inside the parent's `.map()`) because
// `useDistanceDraft` must be called unconditionally, the same number of times
// on every render of ITS OWN component instance — the parent's row list
// changes shape across renders (pagination/filter/add/remove), which would
// violate the Rules of Hooks if the hook were invoked directly inside the
// parent's map callback. `currentValue` is undefined for a base row with no
// override yet (its own "revert to" baseline is genuinely blank, not a real
// canonical number) — text is forced blank whenever there's no override AND
// no in-progress draft, regardless of what baseline value the hook itself is
// keyed on.
function DistanceOverrideCell({
  canonicalUnit,
  currentValue,
  resetKey,
  onCommitValid,
  inputTestId,
  errorTestId,
  readOnly,
}: {
  canonicalUnit: CanonicalUnit | null;
  currentValue: number | undefined;
  resetKey: unknown;
  onCommitValid: (canonicalValue: number) => void;
  inputTestId: string;
  errorTestId: string;
  readOnly: boolean;
}) {
  const draft = useDistanceDraft({
    canonicalUnit,
    value: currentValue ?? 0,
    resetKey,
    presentation: "grouped",
    onCommit: v => {
      if (Number.isFinite(v) && v > 0) onCommitValid(v);
    },
  });
  const text = !draft.isDirty && currentValue == null ? "" : draft.text;

  // Live, as-you-type domain validation (positive-number business rule) —
  // deliberately independent of the unit-toggle grammar's own notion of
  // "complete" (e.g. "5." shows no error here, matching this field's
  // pre-existing whole-value `Number()` behavior; it just won't COMMIT on
  // blur/Enter until it becomes grammar-complete, per the hook's contract).
  // ch4-fixes item 4 — strip grouping BEFORE the numeric check: the idle text
  // is now formatted ("1,234.57") and `Number("1,234.57")` is NaN, which
  // would render a false "must be a positive number" on a perfectly valid
  // committed override.
  const trimmed = stripGrouping(text).trim();
  const numeric = trimmed === "" ? null : Number(trimmed);
  const error =
    trimmed !== "" && (numeric === null || Number.isNaN(numeric) || numeric <= 0) ? "Distance must be a positive number." : null;

  return (
    <div className="flex flex-col gap-0.5">
      {/* text (not type="number") — a native number input's own
          sanitization silently strips a malformed string like "12abc" to
          "" before onChange ever fires, which would make the whole-value
          Number()-vs-parseFloat distinction below unreachable/untestable. */}
      <Input
        type="text"
        inputMode="decimal"
        value={text}
        disabled={readOnly || draft.disabled}
        title={readOnly ? READ_ONLY_TITLE : undefined}
        onChange={e => draft.onChange(e.target.value)}
        onFocus={draft.onFocus}
        onBlur={draft.commit}
        onKeyDown={e => {
          if (e.key === "Enter") draft.commit();
          else if (e.key === "Escape") draft.discard();
        }}
        aria-invalid={error ? "true" : undefined}
        className={`h-7 text-xs w-full min-w-24 font-mono text-center ${error ? "border-destructive" : ""}`}
        data-testid={inputTestId}
      />
      {error && (
        <p className="text-[11px] text-destructive mt-0.5" data-testid={errorTestId}>
          {error}
        </p>
      )}
    </div>
  );
}


// Bundle 6.1, T2 — one row of the merged base+override table. `base === null`
// means there's genuinely no reference pair for this (fromId, toId) — either
// it's a scenario-local added-entity pair, or the model has no reference
// matrix at all (referenceCapable false).
interface MergedRow {
  fromId: string;
  toId: string;
  base: number | null;
  override?: DistanceOverride;
}

// B5.1 — long-format `{fromId, toId, distance}` grid over scenario.inputs'
// distanceOverrides (B1.1), merged (Bundle 6.1, T2) with the model's
// read-only base×base reference matrix (B3) into ONE table: every base pair
// shows its reference distance plus an editable Override cell; added-entity
// pairs (no base counterpart) append with a "—" base.
// SCU-2.P4.3 (B2.1/B2.2) — rendered by the shared DataTable: the From/To
// boxes are gone (FilterMenu > 10 rows, column ids `from`/`to` keep the
// `input-filter-from`/`-to` testids inside the menu), the pager shows only
// above 50 filtered rows, numbers are centred, and every control is
// read-only while browsing history (D2).
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
  locationById,
  identityById,
  canonicalUnit = null,
  readOnly = false,
}: DistancesTabProps) {
  const files = useEntityFileMenus({ entity: "distances", testIdEntity: "distances", modelId, scenarioId, onImportApplied });
  const [addingRow, setAddingRow] = useState(false);
  const [newFrom, setNewFrom] = useState("");
  const [newTo, setNewTo] = useState("");
  const [addError, setAddError] = useState<string | null>(null);

  const { effectiveUnit, toDisplay, pref } = useDisplayUnit();
  const unit = canonicalUnit == null ? null : effectiveUnit(canonicalUnit);
  const unitSuffix = (label: string) => (unit ? `${label} (${unit})` : label);

  // The add-row Distance field (see `DistanceOverrideCell` for why the hook
  // is called unconditionally and why the committed value is read from a ref).
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

  // B3 — fetched only for a model with a reference matrix (an unsupported
  // model would 422); `staleTime: Infinity`, the base matrix is immutable.
  const referenceEnabled = Boolean(referenceCapable && modelId);
  const referenceQuery = useGetReferenceDistances(modelId ?? "", {
    query: {
      enabled: referenceEnabled,
      staleTime: Infinity,
      queryKey: getGetReferenceDistancesQueryKey(modelId ?? ""),
    },
  });

  const warehouseIdSet = new Set(warehouseIds);
  const customerIdSet = new Set(customerIds);
  const inactiveWarehouseIdSet = useMemo(() => new Set(inactiveWarehouseIds ?? []), [inactiveWarehouseIds]);
  const excludedCustomerIdSet = useMemo(() => new Set(excludedCustomerIds ?? []), [excludedCustomerIds]);
  const referencePairs = referenceQuery.data?.pairs ?? [];

  const baseByKey = useMemo(() => new Map(referencePairs.map(p => [pairKey(p.fromId, p.toId), p])), [referencePairs]);
  const overrideByKey = useMemo(() => new Map(distanceOverrides.map(o => [pairKey(o.fromId, o.toId), o])), [distanceOverrides]);
  const savedByKey = useMemo(
    () => new Map(savedDistanceOverrides.map(o => [pairKey(o.fromId, o.toId), o])),
    [savedDistanceOverrides],
  );

  // Resolution #8 — the From/To filters match the display code (an added
  // entity's displayCode, else the id), never the raw uid.
  const displayValue = (id: string) => displayCodeById?.[id] ?? id;

  // Resolution #2/#3 — the effective rows (B2.2 pipeline step 1): a base pair
  // shows when active/included OR it carries a current or saved override;
  // added-entity pairs append after the base rows.
  const mergedRowsAll: MergedRow[] = useMemo(() => {
    const base: MergedRow[] = referencePairs
      .filter(p => {
        const k = pairKey(p.fromId, p.toId);
        const hasOverrideOrSaved = overrideByKey.has(k) || savedByKey.has(k);
        const passesStatus = !inactiveWarehouseIdSet.has(p.fromId) && !excludedCustomerIdSet.has(p.toId);
        return passesStatus || hasOverrideOrSaved;
      })
      .map(p => ({ fromId: p.fromId, toId: p.toId, base: p.distance, override: overrideByKey.get(pairKey(p.fromId, p.toId)) }));
    const added: MergedRow[] = distanceOverrides
      .filter(o => !baseByKey.has(pairKey(o.fromId, o.toId)))
      .map(o => ({ fromId: o.fromId, toId: o.toId, base: null, override: o }));
    return [...base, ...added];
  }, [referencePairs, distanceOverrides, baseByKey, overrideByKey, savedByKey, inactiveWarehouseIdSet, excludedCustomerIdSet]);

  // T11 (workspace-fixups-2, item 2) — compatibility resolver (unchanged).
  function resolvedLocation(id: string): { city: string; state: string } | undefined {
    const existing = locationById?.[id];
    if (existing) return existing;
    if (identityById && mergedRowsAll.length > 10) {
      const entry = identityById[id];
      if (entry && (entry.city || entry.state)) return { city: entry.city, state: entry.state };
    }
    return undefined;
  }
  function resolvedDisplayId(id: string): string {
    return identityById?.[id]?.displayId ?? displayCodeById?.[id] ?? id;
  }

  // Resolution #4 — changed vs SAVED, including a cleared-but-unsaved override.
  function isChangedRow(r: MergedRow): boolean {
    const saved = savedByKey.get(pairKey(r.fromId, r.toId));
    const current = r.override;
    if (!saved && !current) return false;
    if (!saved || !current) return true;
    return saved.distance !== current.distance;
  }

  function commitOverride(r: MergedRow, canonicalValue: number) {
    const key = pairKey(r.fromId, r.toId);
    const nextOverride: DistanceOverride = { fromId: r.fromId, toId: r.toId, distance: canonicalValue, estimated: undefined };
    onChange(
      overrideByKey.has(key)
        ? distanceOverrides.map(o => (pairKey(o.fromId, o.toId) === key ? nextOverride : o))
        : [...distanceOverrides, nextOverride],
    );
  }

  function clearOverride(r: MergedRow) {
    const key = pairKey(r.fromId, r.toId);
    onChange(distanceOverrides.filter(o => pairKey(o.fromId, o.toId) !== key));
  }

  // Resolution #6 + chen-bands-units Task 12 "no fallback unit" (unchanged).
  function baseCell(r: MergedRow) {
    if (canonicalUnit == null) {
      return <Spinner className="w-3 h-3" data-testid={`spinner-distance-unit-${r.fromId}-${r.toId}`} />;
    }
    if (referenceCapable) {
      if (referenceQuery.isLoading) {
        return <Spinner className="w-3 h-3" data-testid={`spinner-distance-base-${r.fromId}-${r.toId}`} />;
      }
      if (referenceQuery.isError) return "unavailable";
    }
    if (r.base == null) return "—";
    return formatDistanceDisplay(toDisplay(r.base, canonicalUnit));
  }

  // Filter values are in the DISPLAY unit — what the student reads in the cell.
  const displayNumber = (v: number | null | undefined) =>
    v == null || canonicalUnit == null ? null : toDisplay(v, canonicalUnit);

  // Rebuilt every render on purpose: the cells close over live props
  // (`onChange` is an inline arrow over Workspace's `updateInputsField`), and a
  // memoised copy would write through a stale closure. DataTable/FilterMenu
  // hold no effect keyed on the columns' identity, so this costs one cheap
  // descriptor derivation per render.
  const columns: ColumnDef<MergedRow>[] = [
    {
      id: "from",
      header: "From",
      kind: "text",
      filter: "text",
      value: r => displayValue(r.fromId),
      cellClassName: "text-xs",
      cell: r => (
        <div className="flex items-center gap-1">
          <EntityIdCell entityId={r.fromId} displayId={resolvedDisplayId(r.fromId)} location={resolvedLocation(r.fromId)} />
          {!warehouseIdSet.has(r.fromId) && (
            <span
              title="Unknown warehouse ID — not found in this scenario's warehouses"
              data-testid={`warning-unknown-from-${r.fromId}-${r.toId}`}
            >
              <AlertTriangle className="w-3 h-3 text-amber-600" />
            </span>
          )}
        </div>
      ),
    },
    {
      id: "to",
      header: "To",
      kind: "text",
      filter: "text",
      value: r => displayValue(r.toId),
      cellClassName: "text-xs",
      cell: r => (
        <div className="flex items-center gap-1">
          <EntityIdCell entityId={r.toId} displayId={resolvedDisplayId(r.toId)} location={resolvedLocation(r.toId)} />
          {!customerIdSet.has(r.toId) && (
            <span
              title="Unknown customer ID — not found in this scenario's customers"
              data-testid={`warning-unknown-to-${r.fromId}-${r.toId}`}
            >
              <AlertTriangle className="w-3 h-3 text-amber-600" />
            </span>
          )}
        </div>
      ),
    },
    {
      id: "base",
      header: unitSuffix("Base"),
      filterLabel: "Base",
      kind: "number",
      filterResetKey: pref,
      value: r => displayNumber(r.base),
      cellClassName: "font-mono text-xs",
      cell: r => baseCell(r),
    },
    {
      id: "override",
      header: unitSuffix("Override"),
      filterLabel: "Override",
      kind: "number",
      filterResetKey: pref,
      value: r => displayNumber(r.override?.distance),
      cell: r => {
        const changed = isChangedRow(r);
        return (
          <div className="flex items-center justify-center gap-1.5">
            <DistanceOverrideCell
              canonicalUnit={canonicalUnit}
              currentValue={r.override?.distance}
              // Discards a stale draft on scenario switch AND when this row's
              // override is cleared out from under it (the remove button).
              resetKey={`${scenarioId ?? ""}:${r.override ? "1" : "0"}`}
              onCommitValid={v => commitOverride(r, v)}
              inputTestId={`input-distance-${r.fromId}-${r.toId}`}
              errorTestId={`text-distance-error-${r.fromId}-${r.toId}`}
              readOnly={readOnly}
            />
            {r.override?.estimated && (
              <span
                className="text-[10px] text-sky-700 bg-sky-100 border border-sky-300 rounded px-1"
                data-testid={`badge-distance-estimated-${r.fromId}-${r.toId}`}
              >
                Estimated
              </span>
            )}
            {changed && (
              <span
                className="text-[10px] text-amber-700 bg-amber-100 border border-amber-300 rounded px-1"
                data-testid={`badge-distance-changed-${r.fromId}-${r.toId}`}
              >
                Changed
              </span>
            )}
          </div>
        );
      },
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
          <DeleteRowButton label={`Remove distance override ${r.fromId} → ${r.toId}`} onClick={() => clearOverride(r)} disabled={readOnly} testId={`button-remove-distance-${r.fromId}-${r.toId}`} />
        ),
    },
  ];

  function handleAddRow() {
    const fromId = newFrom.trim();
    const toId = newTo.trim();
    // Resolve a pending typed value synchronously (see newDistanceCanonicalRef).
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

  const addRowUi = addingRow ? (
    <div className="flex items-start gap-1.5 mt-2" data-testid="add-distance-row-form">
      <Input
        placeholder="From ID (warehouse)"
        value={newFrom}
        onChange={e => setNewFrom(e.target.value)}
        className="h-7 text-xs w-36"
        disabled={readOnly}
        title={readOnly ? READ_ONLY_TITLE : undefined}
        data-testid="input-new-distance-from"
      />
      <Input
        placeholder="To ID (customer)"
        value={newTo}
        onChange={e => setNewTo(e.target.value)}
        className="h-7 text-xs w-36"
        disabled={readOnly}
        title={readOnly ? READ_ONLY_TITLE : undefined}
        data-testid="input-new-distance-to"
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
        data-testid="input-new-distance-value"
      />
      <Button
        size="sm"
        className="h-7 px-2 text-xs"
        onClick={handleAddRow}
        disabled={readOnly}
        title={readOnly ? READ_ONLY_TITLE : undefined}
        data-testid="button-add-distance-confirm"
      >
        Add
      </Button>
      <Button
        size="sm"
        variant="ghost"
        className="h-7 px-2 text-xs"
        onClick={cancelAddRow}
        data-testid="button-add-distance-cancel"
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
      data-testid="button-add-distance-row"
    >
      + Add row
    </Button>
  );

  const table = (
    <DataTable<MergedRow>
      rows={mergedRowsAll}
      rowKey={r => pairKey(r.fromId, r.toId)}
      columns={columns}
      rowClassName={(r) => (isChangedRow(r) ? "bg-amber-50" : r.override?.estimated ? "bg-sky-50" : undefined)}
      testIds={{
        toolbar: "distances-tab-toolbar",
        row: r => `row-distance-${r.fromId}-${r.toId}`,
        pagerPrev: "button-distances-prev",
        pagerNext: "button-distances-next",
        pageIndicator: "distances-page-indicator",
        empty: "distances-tab-empty",
      }}
      toolbar={{ upload: files.upload, download: files.download }}
      scrollClassName="max-h-[55vh] overflow-y-auto"
      emptyState={
        <p className="text-sm text-muted-foreground">No distance overrides yet — add one below, or upload a CSV/JSON file.</p>
      }
      // Phase 3.2 Task 4 — the precheck toast's "jump to it": clear filters,
      // go to the target's page, scroll it into view. A jump requested before the
      // reference matrix loads is retried by DataTable when `rows` changes
      // (the token must NOT include the row count: add/delete would re-fire it).
      focus={
        focusEntityId
          ? {
              token: focusEntityId,
              matches: r => r.fromId === focusEntityId || r.toId === focusEntityId,
            }
          : null
      }
    />
  );

  return (
    <div data-testid="distances-tab">
      {referenceCapable && referenceQuery.isError && (
        <p className="text-xs text-destructive mb-2" data-testid="distances-reference-error">
          Failed to load reference distances.
        </p>
      )}
      {referenceCapable && referenceQuery.isLoading && (
        <p className="text-xs text-muted-foreground mb-2" data-testid="distances-reference-loading">
          Loading reference distances…
        </p>
      )}
      {/* Compat wrapper: present exactly when the model has a base×base matrix. */}
      {referenceCapable ? <div data-testid="distances-reference-section">{table}</div> : table}
      {addRowUi}
      {addError && (
        <p className="text-[11px] text-destructive mt-1" data-testid="text-add-distance-error">
          {addError}
        </p>
      )}
      {files.dialog}
    </div>
  );
}
