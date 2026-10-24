import { useMemo, useRef, useState } from "react";
import { AlertTriangle } from "lucide-react";
import type { Scenario } from "@workspace/api-client-react";
import { useGetReferenceDistances, getGetReferenceDistancesQueryKey } from "@workspace/api-client-react";
import type { CanonicalUnit } from "@workspace/units";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import { DataTable } from "@/components/data-table/DataTable";
import type { ColumnDef } from "@/components/data-table/types";
import { DeleteRowButton, READ_ONLY_TITLE } from "@/components/data-table/entityCells";
import { useEntityFileMenus } from "@/components/data-table/useEntityFileMenus";
import { entityFilterText } from "@/lib/formatLocation";
import { EntityIdCell } from "@/components/tables/EntityIdCell";
import { useDisplayUnit } from "@/contexts/UnitContext";
import { useDistanceDraft } from "@/hooks/useDistanceDraft";
import { formatDistanceDisplay, stripGrouping } from "@/lib/formatDistanceDisplay";
import { laneCostPerTon, minChargeBinds, TEXTBOOK_TRANSPORT_COSTS, type TransportCosts } from "@/lib/transportCosts";

// jade-T15 — Chapter 9 JADE's Distances tab: single `distances.json` covering
// BOTH legs (plant->warehouse, warehouse->customer) in one flat array, keyed
// by the TRIPLE (leg, fromId, toId) — not the pair. This is a genuinely
// different shape from both siblings, so it's its own component (matching
// this codebase's established per-model-shape precedent — LegDistancesTab
// for two-echelon-gold-au, DistancesTab for p-median-us) rather than an
// extension of either:
//   - unlike two-echelon-gold-au's LegDistancesTab (leg purely inferred from
//     which id-space fromId/toId belong to, no reference matrix at all),
//     JADE's `distanceOverrideSchema` carries an EXPLICIT, required `leg`
//     field (jadeInputs.ts's own header comment: the id spaces aren't
//     guaranteed to stay mutually exclusive once entities can be added
//     freely across three roles — defense in depth) and the
//     reference-distances endpoint tags every pair with `leg` too
//     (referenceDistances.ts's buildJadeReferenceDistancePairs).
//   - unlike p-median-us's DistancesTab (pair-keyed, one implicit leg), this
//     table's row identity is the triple, so two of its structural
//     invariants (pairKey, uniqueness) are widened to a triple.
// Otherwise mirrors DistancesTab.tsx's merged base+override single table
// exactly: pagination, From/To filters, `displayCode` substitution for
// scenario-local added entities, the 4 override transitions (add/edit/clear/
// clear-saved-stays-Changed), estimated-row chips, load/error states, and
// Upload/Download wired to T7's `legDistances` export/import entity (the
// SAME entity string two-echelon-gold-au's LegDistancesTab already uses —
// the backend reuses one route/service layer for both models' composite-key
// grid, see routes/scenarios.ts's `entityIsJade`/`entityIsTwoEchelon`
// branches).

export type JadeLeg = "plant_to_warehouse" | "warehouse_to_customer";

export interface JadeDistanceOverride {
  leg: JadeLeg;
  fromId: string;
  toId: string;
  distance: number;
  /** T1 (Input Map v2) precedent — true when this row was auto-filled by the
   * backend's haversine normalizer rather than entered or imported by the
   * student. Purely a display flag — editing the distance drops it,
   * treating the edit as a confirmation. */
  estimated?: boolean;
}

interface JadeDistancesTabProps {
  /** The scenario's CURRENT distanceOverrides array (localInputs draft). */
  distanceOverrides: JadeDistanceOverride[];
  /** The last-SAVED distanceOverrides array — diffed against
   * `distanceOverrides` purely to drive the changed-row highlight. Never
   * written to. */
  savedDistanceOverrides: JadeDistanceOverride[];
  /** Known plant ids (base dataset + any scenario-local addedPlants) — used
   * for a cheap client-side existence check on a plant_to_warehouse row's
   * fromId. B2.1-style precheck remains the authoritative check the Solve
   * flow actually gates on; this is a nice-to-have early warning. */
  plantIds: string[];
  /** Known warehouse ids (base dataset + addedWarehouses) — the middle role,
   * adjacent to BOTH legs (toId of plant_to_warehouse, fromId of
   * warehouse_to_customer). */
  warehouseIds: string[];
  /** Known customer ids (base dataset + addedCustomers). */
  customerIds: string[];
  onChange: (next: JadeDistanceOverride[]) => void;
  /** Undefined while the scenario hasn't resolved yet — Upload/Download stay disabled until it has. */
  scenarioId?: number;
  /** Fired after a successful import apply, with the updated scenario. */
  onImportApplied?: (scenario: Scenario) => void;
  /** Phase 3.2, Task 4 pattern — when set, scroll/highlight the row(s)
   * referencing this entity id (the post-Save precheck toast's "jump to it"
   * action). Cleared by the consumer after use. */
  focusEntityId?: string | null;
  /** Scenario-local added entities' `id -> displayCode` map (Workspace.tsx
   * builds this from addedPlants/addedWarehouses/addedCustomers). From/To
   * cells look up through this for DISPLAY ONLY — the underlying stored
   * fromId/toId (the uid) stays the join key everywhere else. Base dataset
   * ids have no entry here and fall back to showing the raw id, unchanged. */
  displayCodeById?: Record<string, string>;
  /** Scenario id -> {city, state} map (base dataset ∪ added entities), built
   * by Workspace.tsx. From/To cells show "City, ST" as the primary label with
   * the id/displayCode as a sub-label. DISPLAY ONLY — the stored fromId/toId
   * uid stays the join key. Ids absent here fall back to id-only display. */
  locationById?: Record<string, { city: string; state: string }>;
  /** The active model's id (always "two-echelon-jade-us" in practice), used
   * to fetch its reference-distance matrix. Optional: absent (or
   * `referenceCapable` false) means the merged table becomes
   * override-rows-only. */
  modelId?: string;
  /** Mirrors `manifest.capabilities.supportsReferenceDistances`. The
   * reference fetch only fires when this is true AND `modelId` is set. */
  referenceCapable?: boolean;
  /** Base-dataset warehouse ids currently INACTIVE in the scenario's live
   * (unsaved) `localInputs` draft. Purely a view filter over the immutable
   * reference matrix — never refetched, just hides rows whose warehouse
   * endpoint is presently inactive (unless the pair carries a current or
   * saved override). Applies to BOTH legs a warehouse participates in. */
  inactiveWarehouseIds?: string[];
  /** Base-dataset customer ids currently EXCLUDED in the scenario's live
   * `localInputs` draft. Same filter semantics, applies only to the
   * warehouse_to_customer leg's toId (plants have no status concept at
   * all — jadeInputs.ts's own header comment). */
  excludedCustomerIds?: string[];
  /** T11 (workspace-fixups-2, item 2) — canonical id -> {city, state,
   * displayId}, built by Workspace.tsx's `buildEntityIdentityById(modelId,
   * dataset, localInputs)` (the LIVE draft — this is an INPUT tab). This
   * table is already-rich (JADE always passes `locationById`), so the
   * compatibility resolver is unconditional (no `>10` gate needed): prefer
   * `identityById`, else the existing `locationById`/`displayCodeById`
   * sources, else the canonical id — leaving this prop unset is
   * byte-unchanged. */
  identityById?: Record<string, { city: string; state: string; displayId: string }>;
  /** chen-bands-units, Task 12 — the active model's canonical distance unit
   * ("km" | "mi"), sourced from the manifest. `null`/undefined while it
   * hasn't resolved yet — there is NO fallback: every value/label below and
   * every editable cell stays gated (no number, no unit suffix, disabled
   * input) until this is authoritative (Part D, "No fallback unit"). Wired
   * by Workspace.tsx (Task 14). */
  canonicalUnit?: CanonicalUnit | null;
  /** ch9-tc — the scenario's EFFECTIVE transportation rates, used only to
   *  DERIVE the $/ton and Min? columns. Never stored per lane and never
   *  editable here — the Transportation Costs tab owns the four values, and
   *  these columns recompute from the same live draft, so they cannot
   *  drift. Defaults to the textbook values for a caller that omits it. */
  transportCosts?: TransportCosts;
  /** SCU-2.P4.5 (D2) — browsing result history: override cells, remove
   * buttons and the add-row trigger are disabled. */
  readOnly?: boolean;
}

const LEG_LABEL: Record<JadeLeg, string> = {
  plant_to_warehouse: "Plant → Warehouse",
  warehouse_to_customer: "Warehouse → Customer",
};

// ch9-tc — the lane's effective distance is the override when set, else the
// base; both are CANONICAL (miles for this model), which is also the rate's
// denominator, so the product is a plain $/ton with no distance unit.
function laneRates(leg: JadeLeg, tc: TransportCosts): { rate: number; min: number } {
  return leg === "plant_to_warehouse"
    ? { rate: tc.icTransCost, min: tc.icMinTrans }
    : { rate: tc.obTransCost, min: tc.obMinTrans };
}

// chen-bands-units, Task 12 — one row's Override cell, the triple-keyed
// analogue of DistancesTab's own `DistanceOverrideCell` (same Rules-of-Hooks
// reason: `useDistanceDraft` must be called unconditionally once per
// row-component-instance, not inline inside the parent's `.map()`).
// `currentValue` is undefined for a base row with no override yet — text is
// forced blank whenever there's no override AND no in-progress draft.
function JadeDistanceOverrideCell({
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

  // Live, as-you-type domain validation — deliberately independent of the
  // unit-toggle grammar's own notion of "complete" (mirrors DistancesTab's
  // own `DistanceOverrideCell`, this component's non-triple-keyed sibling).
  // ch4-fixes item 4 — see DistancesTab.tsx: the idle text is now grouped
  // ("1,234.57") and `Number()` rejects the separator, so strip first or a
  // valid committed override renders a false validation error.
  const trimmed = stripGrouping(text).trim();
  const numeric = trimmed === "" ? null : Number(trimmed);
  const error =
    trimmed !== "" && (numeric === null || Number.isNaN(numeric) || numeric <= 0) ? "Distance must be a positive number." : null;

  return (
    <div className="flex flex-col gap-0.5">
      {/* text (not type="number") — a native number input's own
          sanitization silently strips a malformed string like "12abc" to
          "" before onChange ever fires. */}
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

function tripleKey(leg: string, fromId: string, toId: string): string {
  return `${leg}|${fromId}|${toId}`;
}


// `base === null` means there's genuinely no reference pair for this
// (leg, fromId, toId) — either it's a scenario-local added-entity pair, or
// the model has no reference matrix at all (referenceCapable false).
interface MergedRow {
  leg: JadeLeg;
  fromId: string;
  toId: string;
  base: number | null;
  override?: JadeDistanceOverride;
}

// SCU-2.P4.5 (B2.1/B2.2) — rendered by the shared DataTable: FilterMenu
// (from/to search "City, ST code" as before, plus auto-derived leg/number
// filters) above 10 rows, pager above 50, numbers centred, history read-only.
export function JadeDistancesTab({
  distanceOverrides,
  savedDistanceOverrides,
  plantIds,
  warehouseIds,
  customerIds,
  onChange,
  scenarioId,
  onImportApplied,
  focusEntityId,
  displayCodeById,
  locationById,
  modelId,
  referenceCapable,
  inactiveWarehouseIds,
  excludedCustomerIds,
  identityById,
  canonicalUnit = null,
  transportCosts = TEXTBOOK_TRANSPORT_COSTS,
  readOnly = false,
}: JadeDistancesTabProps) {
  const files = useEntityFileMenus({
    entity: "legDistances",
    testIdEntity: "legdistances",
    modelId,
    scenarioId,
    onImportApplied,
  });
  const [addingRow, setAddingRow] = useState(false);
  const [newLeg, setNewLeg] = useState<JadeLeg>("plant_to_warehouse");
  const [newFrom, setNewFrom] = useState("");
  const [newTo, setNewTo] = useState("");
  const [addError, setAddError] = useState<string | null>(null);

  const { effectiveUnit, toDisplay, pref } = useDisplayUnit();
  const unit = canonicalUnit == null ? null : effectiveUnit(canonicalUnit);
  const unitSuffix = (label: string) => (unit ? `${label} (${unit})` : label);
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

  const referenceEnabled = Boolean(referenceCapable && modelId);
  const referenceQuery = useGetReferenceDistances(modelId ?? "", {
    query: {
      enabled: referenceEnabled,
      staleTime: Infinity,
      queryKey: getGetReferenceDistancesQueryKey(modelId ?? ""),
    },
  });

  const plantIdSet = new Set(plantIds);
  const warehouseIdSet = new Set(warehouseIds);
  const customerIdSet = new Set(customerIds);

  const inactiveWarehouseIdSet = useMemo(() => new Set(inactiveWarehouseIds ?? []), [inactiveWarehouseIds]);
  const excludedCustomerIdSet = useMemo(() => new Set(excludedCustomerIds ?? []), [excludedCustomerIds]);
  const referencePairs = referenceQuery.data?.pairs ?? [];

  const baseByKey = useMemo(
    () => new Map(referencePairs.map(p => [tripleKey(p.leg ?? "warehouse_to_customer", p.fromId, p.toId), p])),
    [referencePairs],
  );
  const overrideByKey = useMemo(
    () => new Map(distanceOverrides.map(o => [tripleKey(o.leg, o.fromId, o.toId), o])),
    [distanceOverrides],
  );
  const savedByKey = useMemo(
    () => new Map(savedDistanceOverrides.map(o => [tripleKey(o.leg, o.fromId, o.toId), o])),
    [savedDistanceOverrides],
  );

  const displayValue = (id: string) => displayCodeById?.[id] ?? id;

  function resolvedLocation(id: string): { city: string; state: string } | undefined {
    const entry = identityById?.[id];
    if (entry && (entry.city || entry.state)) return { city: entry.city, state: entry.state };
    return locationById?.[id];
  }
  function resolvedDisplayId(id: string): string {
    return identityById?.[id]?.displayId ?? displayCodeById?.[id] ?? id;
  }

  // The from/to filters search "City, ST code" (unchanged from the pre-DataTable FilterMenu).
  const searchText = (id: string) => entityFilterText(id, displayValue(id), locationById, identityById);

  function passesStatus(leg: JadeLeg, fromId: string, toId: string): boolean {
    if (leg === "plant_to_warehouse") return !inactiveWarehouseIdSet.has(toId);
    return !inactiveWarehouseIdSet.has(fromId) && !excludedCustomerIdSet.has(toId);
  }

  // Effective rows: base triples (status-filtered unless they carry a current
  // or saved override), then added triples.
  const mergedRowsAll: MergedRow[] = useMemo(() => {
    const base: MergedRow[] = referencePairs
      .filter(p => {
        const leg = p.leg ?? "warehouse_to_customer";
        const k = tripleKey(leg, p.fromId, p.toId);
        const hasOverrideOrSaved = overrideByKey.has(k) || savedByKey.has(k);
        return passesStatus(leg, p.fromId, p.toId) || hasOverrideOrSaved;
      })
      .map(p => {
        const leg = p.leg ?? "warehouse_to_customer";
        return {
          leg,
          fromId: p.fromId,
          toId: p.toId,
          base: p.distance,
          override: overrideByKey.get(tripleKey(leg, p.fromId, p.toId)),
        };
      });
    const added: MergedRow[] = distanceOverrides
      .filter(o => !baseByKey.has(tripleKey(o.leg, o.fromId, o.toId)))
      .map(o => ({ leg: o.leg, fromId: o.fromId, toId: o.toId, base: null, override: o }));
    return [...base, ...added];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [referencePairs, distanceOverrides, baseByKey, overrideByKey, savedByKey, inactiveWarehouseIdSet, excludedCustomerIdSet]);

  function isChangedRow(r: MergedRow): boolean {
    const saved = savedByKey.get(tripleKey(r.leg, r.fromId, r.toId));
    const current = r.override;
    if (!saved && !current) return false;
    if (!saved || !current) return true;
    return saved.distance !== current.distance;
  }

  function commitOverride(r: MergedRow, canonicalValue: number) {
    const key = tripleKey(r.leg, r.fromId, r.toId);
    const nextOverride: JadeDistanceOverride = {
      leg: r.leg,
      fromId: r.fromId,
      toId: r.toId,
      distance: canonicalValue,
      estimated: undefined,
    };
    onChange(
      overrideByKey.has(key)
        ? distanceOverrides.map(o => (tripleKey(o.leg, o.fromId, o.toId) === key ? nextOverride : o))
        : [...distanceOverrides, nextOverride],
    );
  }

  function clearOverride(r: MergedRow) {
    const key = tripleKey(r.leg, r.fromId, r.toId);
    onChange(distanceOverrides.filter(o => tripleKey(o.leg, o.fromId, o.toId) !== key));
  }

  function baseCell(r: MergedRow) {
    if (canonicalUnit == null) {
      return <Spinner className="w-3 h-3" data-testid={`spinner-jadedistance-unit-${r.leg}-${r.fromId}-${r.toId}`} />;
    }
    if (referenceCapable) {
      if (referenceQuery.isLoading) {
        return <Spinner className="w-3 h-3" data-testid={`spinner-jadedistance-base-${r.leg}-${r.fromId}-${r.toId}`} />;
      }
      if (referenceQuery.isError) return "unavailable";
    }
    if (r.base == null) return "—";
    return formatDistanceDisplay(toDisplay(r.base, canonicalUnit));
  }

  function fromRoleId(leg: JadeLeg): Set<string> {
    return leg === "plant_to_warehouse" ? plantIdSet : warehouseIdSet;
  }
  function toRoleId(leg: JadeLeg): Set<string> {
    return leg === "plant_to_warehouse" ? warehouseIdSet : customerIdSet;
  }

  // ch9-tc — $/ton from the effective (override ?? base) CANONICAL distance.
  function laneCost(r: MergedRow): { cost: number; binds: boolean } | null {
    const effective = r.override?.distance ?? r.base;
    if (effective == null) return null;
    const { rate, min } = laneRates(r.leg, transportCosts);
    return { cost: laneCostPerTon(effective, rate, min), binds: minChargeBinds(effective, rate, min) };
  }

  const displayNumber = (v: number | null | undefined) =>
    v == null || canonicalUnit == null ? null : toDisplay(v, canonicalUnit);

  // Rebuilt every render: cells close over live props (see DistancesTab).
  const columns: ColumnDef<MergedRow>[] = [
    {
      id: "leg",
      header: "Leg",
      kind: "enum",
      value: r => LEG_LABEL[r.leg],
      cell: r => (
        <Badge variant="secondary" data-testid={`badge-leg-${r.leg}-${r.fromId}-${r.toId}`}>
          {LEG_LABEL[r.leg]}
        </Badge>
      ),
    },
    {
      id: "from",
      header: "From",
      kind: "text",
      filter: "text",
      value: r => searchText(r.fromId),
      cellClassName: "text-xs",
      cell: r => (
        <div className="flex items-center gap-1">
          <EntityIdCell entityId={r.fromId} displayId={resolvedDisplayId(r.fromId)} location={resolvedLocation(r.fromId)} />
          {!fromRoleId(r.leg).has(r.fromId) && (
            <span title="Unknown ID for this leg's From role" data-testid={`warning-unknown-from-${r.leg}-${r.fromId}-${r.toId}`}>
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
      value: r => searchText(r.toId),
      cellClassName: "text-xs",
      cell: r => (
        <div className="flex items-center gap-1">
          <EntityIdCell entityId={r.toId} displayId={resolvedDisplayId(r.toId)} location={resolvedLocation(r.toId)} />
          {!toRoleId(r.leg).has(r.toId) && (
            <span title="Unknown ID for this leg's To role" data-testid={`warning-unknown-to-${r.leg}-${r.fromId}-${r.toId}`}>
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
      cell: r => (
        <div className="flex items-center justify-center gap-1.5">
          <JadeDistanceOverrideCell
            canonicalUnit={canonicalUnit}
            currentValue={r.override?.distance}
            resetKey={`${scenarioId ?? ""}:${r.override ? "1" : "0"}`}
            onCommitValid={v => commitOverride(r, v)}
            inputTestId={`input-jadedistance-${r.leg}-${r.fromId}-${r.toId}`}
            errorTestId={`text-jadedistance-error-${r.leg}-${r.fromId}-${r.toId}`}
            readOnly={readOnly}
          />
          {r.override?.estimated && (
            <span
              className="text-[10px] text-sky-700 bg-sky-100 border border-sky-300 rounded px-1"
              data-testid={`badge-jadedistance-estimated-${r.leg}-${r.fromId}-${r.toId}`}
            >
              Estimated
            </span>
          )}
          {isChangedRow(r) && (
            <span
              className="text-[10px] text-amber-700 bg-amber-100 border border-amber-300 rounded px-1"
              data-testid={`badge-jadedistance-changed-${r.leg}-${r.fromId}-${r.toId}`}
            >
              Changed
            </span>
          )}
        </div>
      ),
    },
    {
      id: "cost",
      header: "$/ton",
      kind: "number",
      value: r => laneCost(r)?.cost ?? null,
      cellClassName: "font-mono text-xs",
      cellTestId: r => `cell-jadedistance-cost-${r.leg}-${r.fromId}-${r.toId}`,
      cell: r => {
        const c = laneCost(r);
        return c == null ? "—" : c.cost.toFixed(2);
      },
    },
    {
      id: "min",
      header: "Min?",
      kind: "enum",
      value: r => (laneCost(r)?.binds ? "min" : null),
      cellClassName: "text-xs",
      cell: r =>
        laneCost(r)?.binds && (
          <span
            className="text-[10px] text-slate-700 bg-slate-100 border border-slate-300 rounded px-1"
            title="The minimum charge, not the rate, is what this lane pays"
            data-testid={`badge-jadedistance-min-${r.leg}-${r.fromId}-${r.toId}`}
          >
            min
          </span>
        ),
    },
    {
      id: "remove",
      header: "",
      kind: "text",
      filter: false,
      value: () => null,
      cell: r =>
        (r.override || r.base == null) && (
          <DeleteRowButton label={`Remove distance override ${r.fromId} → ${r.toId} (${LEG_LABEL[r.leg]})`} onClick={() => clearOverride(r)} disabled={readOnly} testId={`button-remove-jadedistance-${r.leg}-${r.fromId}-${r.toId}`} />
        ),
    },
  ];

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
    if (distanceOverrides.some(o => o.leg === newLeg && o.fromId === fromId && o.toId === toId)) {
      setAddError("A distance override for this (leg, from, to) triple already exists — edit it in the table instead.");
      return;
    }

    setAddError(null);
    onChange([...distanceOverrides, { leg: newLeg, fromId, toId, distance }]);
    setNewFrom("");
    setNewTo("");
    newDistanceDraft.discard();
    newDistanceCanonicalRef.current = null;
    setAddingRow(false);
  }

  function cancelAddRow() {
    setAddingRow(false);
    setNewLeg("plant_to_warehouse");
    setNewFrom("");
    setNewTo("");
    newDistanceDraft.discard();
    newDistanceCanonicalRef.current = null;
    setAddError(null);
  }

  const addRowUi = addingRow ? (
    <div className="flex items-start gap-1.5 mt-2 flex-wrap" data-testid="add-jadedistance-row-form">
      <select
        value={newLeg}
        onChange={e => setNewLeg(e.target.value as JadeLeg)}
        className="h-7 text-xs border rounded pl-1"
        disabled={readOnly}
        title={readOnly ? READ_ONLY_TITLE : undefined}
        data-testid="select-new-jadedistance-leg"
      >
        <option value="plant_to_warehouse">Plant → Warehouse</option>
        <option value="warehouse_to_customer">Warehouse → Customer</option>
      </select>
      <Input
        placeholder="From ID"
        value={newFrom}
        onChange={e => setNewFrom(e.target.value)}
        className="h-7 text-xs w-36"
        disabled={readOnly}
        title={readOnly ? READ_ONLY_TITLE : undefined}
        data-testid="input-new-jadedistance-from"
      />
      <Input
        placeholder="To ID"
        value={newTo}
        onChange={e => setNewTo(e.target.value)}
        className="h-7 text-xs w-36"
        disabled={readOnly}
        title={readOnly ? READ_ONLY_TITLE : undefined}
        data-testid="input-new-jadedistance-to"
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
        data-testid="input-new-jadedistance-value"
      />
      <Button
        size="sm"
        className="h-7 px-2 text-xs"
        onClick={handleAddRow}
        disabled={readOnly}
        title={readOnly ? READ_ONLY_TITLE : undefined}
        data-testid="button-add-jadedistance-confirm"
      >
        Add
      </Button>
      <Button
        size="sm"
        variant="ghost"
        className="h-7 px-2 text-xs"
        onClick={cancelAddRow}
        data-testid="button-add-jadedistance-cancel"
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
      data-testid="button-add-jadedistance-row"
    >
      + Add row
    </Button>
  );

  const table = (
    <DataTable<MergedRow>
      rows={mergedRowsAll}
      rowKey={r => tripleKey(r.leg, r.fromId, r.toId)}
      columns={columns}
      rowClassName={(r) => (isChangedRow(r) ? "bg-amber-50" : r.override?.estimated ? "bg-sky-50" : undefined)}
      testIds={{
        toolbar: "jadedistances-tab-toolbar",
        row: r => `row-jadedistance-${r.leg}-${r.fromId}-${r.toId}`,
        pagerPrev: "button-jadedistances-prev",
        pagerNext: "button-jadedistances-next",
        pageIndicator: "jadedistances-page-indicator",
        empty: "jade-distances-tab-empty",
      }}
      toolbar={{ upload: files.upload, download: files.download }}
      scrollClassName="max-h-[55vh] overflow-y-auto"
      emptyState={
        <p className="text-sm text-muted-foreground">No distance overrides yet — add one below, or upload a CSV/JSON file.</p>
      }
      // Jump-to-it (today's behaviour): clear filters, page to the first
      // matching row of the unfiltered list, scroll it into view. A jump requested
      // before the reference matrix loaded is retried on `rows` (no row count in the token).
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
    <div data-testid="jade-distances-tab">
      {referenceCapable && referenceQuery.isError && (
        <p className="text-xs text-destructive mb-2" data-testid="jadedistances-reference-error">
          Failed to load reference distances.
        </p>
      )}
      {referenceCapable && referenceQuery.isLoading && (
        <p className="text-xs text-muted-foreground mb-2" data-testid="jadedistances-reference-loading">
          Loading reference distances…
        </p>
      )}
      {referenceCapable ? <div data-testid="jadedistances-reference-section">{table}</div> : table}
      {addRowUi}
      {addError && (
        <p className="text-[11px] text-destructive mt-1" data-testid="text-add-jadedistance-error">
          {addError}
        </p>
      )}
      {files.dialog}
    </div>
  );
}
