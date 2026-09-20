import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Download, Upload, X } from "lucide-react";
import type { Scenario } from "@workspace/api-client-react";
import { useGetReferenceDistances, getGetReferenceDistancesQueryKey } from "@workspace/api-client-react";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import { ImportDialog } from "@/components/ImportDialog";
import { downloadEntityExport } from "@/lib/exportEntity";
import { formatCityState } from "@/lib/formatLocation";
import { EntityIdCell } from "@/components/tables/EntityIdCell";
import { FilterMenu } from "@/components/tables/FilterMenu";
import { useTableFilters, type ColumnFilterDescriptor, type FilterValue } from "@/lib/useTableFilters";

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
}

const LEG_LABEL: Record<JadeLeg, string> = {
  plant_to_warehouse: "Plant → Warehouse",
  warehouse_to_customer: "Warehouse → Customer",
};

function tripleKey(leg: string, fromId: string, toId: string): string {
  return `${leg}|${fromId}|${toId}`;
}

function Pager({
  page,
  pageCount,
  onPrev,
  onNext,
  idPrefix,
}: {
  page: number;
  pageCount: number;
  onPrev: () => void;
  onNext: () => void;
  idPrefix: string;
}) {
  return (
    <div className="flex items-center justify-end gap-2 mt-1 text-xs">
      <Button
        size="sm"
        variant="outline"
        className="h-6 px-2 text-xs"
        disabled={page <= 1}
        onClick={onPrev}
        data-testid={`button-${idPrefix}-prev`}
      >
        Prev
      </Button>
      <span className="font-mono text-[11px] text-muted-foreground" data-testid={`${idPrefix}-page-indicator`}>
        Page {page} of {pageCount}
      </span>
      <Button
        size="sm"
        variant="outline"
        className="h-6 px-2 text-xs"
        disabled={page >= pageCount}
        onClick={onNext}
        data-testid={`button-${idPrefix}-next`}
      >
        Next
      </Button>
    </div>
  );
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
}: JadeDistancesTabProps) {
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [importOpen, setImportOpen] = useState(false);
  const [addingRow, setAddingRow] = useState(false);
  const [newLeg, setNewLeg] = useState<JadeLeg>("plant_to_warehouse");
  const [newFrom, setNewFrom] = useState("");
  const [newTo, setNewTo] = useState("");
  const [newDistance, setNewDistance] = useState("");
  const [addError, setAddError] = useState<string | null>(null);

  const PAGE_SIZE = 50;
  const [page, setPage] = useState(1);

  // Called UNCONDITIONALLY (Rules of Hooks) with `enabled` gating the actual
  // request. `staleTime: Infinity` — the base matrix is immutable (DD-1),
  // fetched once per model per session; a tab remount must not revalidate.
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

  // T11 (workspace-fixups-2, item 2) — compatibility resolver: prefer
  // `identityById`, else the existing `locationById`/`displayCodeById`
  // sources, else the canonical id. This table is already-rich (JADE always
  // passes `locationById`), so no `>10` gate is needed here (unlike
  // DistancesTab's p-median-us/brazil path, which previously had no
  // location source at all).
  function resolvedLocation(id: string): { city: string; state: string } | undefined {
    const entry = identityById?.[id];
    if (entry && (entry.city || entry.state)) return { city: entry.city, state: entry.state };
    return locationById?.[id];
  }
  function resolvedDisplayId(id: string): string {
    return identityById?.[id]?.displayId ?? displayCodeById?.[id] ?? id;
  }

  // "City, ST" primary label for From/To (base dataset ∪ added entities).
  // undefined when the id has no known location — caller falls back to the id.
  const locationLabel = (id: string) => {
    const loc = resolvedLocation(id);
    return loc ? formatCityState(loc.city, loc.state) : undefined;
  };
  // Combined text a From/To filter matches against: the "City, ST" label AND
  // the id/displayCode, so filtering by either city or id works.
  const searchText = (id: string) => `${locationLabel(id) ?? ""} ${displayValue(id)}`;

  // A warehouse sits in the MIDDLE of both legs: `inactiveWarehouseIds`
  // suppresses a pair on whichever side of that leg the warehouse occupies
  // (toId for the inbound leg, fromId for the outbound leg). Plants have no
  // status concept at all (jadeInputs.ts's own header comment — no
  // `addedPlantSchema.status` field, no `warehouseOverrides`-equivalent for
  // plants), so the inbound leg's fromId is never filtered.
  function passesStatus(leg: JadeLeg, fromId: string, toId: string): boolean {
    if (leg === "plant_to_warehouse") {
      return !inactiveWarehouseIdSet.has(toId);
    }
    return !inactiveWarehouseIdSet.has(fromId) && !excludedCustomerIdSet.has(toId);
  }

  // Complete, UNFILTERED (no text search) merged row list: a base pair
  // passes when it's active/included OR it carries a current or saved
  // override (a saved-but-now-cleared override is a pending deletion that
  // must stay visible + "Changed" until Save).
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

  // B7 (JADE Ch.9 Workspace Bundle, spec §10) — migrated from the old
  // free-text From/To `Input`s to the shared A3 `FilterMenu`/
  // `useTableFilters`. Descriptor keys are deliberately "from"/"to" —
  // `FilterMenu` derives each control's `data-testid` as
  // `input-filter-${key}`, so this preserves the pre-migration testids
  // (`input-filter-from`/`input-filter-to`) exactly, just now rendered
  // inside a popover. `searchText` (defined above) is unchanged — same
  // "City, ST" ∪ display-code/id substring match as before.
  const distanceFilterDescriptors: ColumnFilterDescriptor<MergedRow>[] = [
    { key: "from", label: "From", type: "text", accessor: r => searchText(r.fromId) },
    { key: "to", label: "To", type: "text", accessor: r => searchText(r.toId) },
  ];
  const rawTableFilters = useTableFilters(mergedRowsAll, distanceFilterDescriptors);
  const mergedRows: MergedRow[] = rawTableFilters.filteredRows;

  // Page resets to 1 on any user-driven filter EDIT (mirrors the old
  // per-`Input` `onChange`'s own `setPage(1)`), but NOT when the focus
  // effect below clears filters as part of a deliberate page jump — hence a
  // SEPARATE wrapped object (`filterMenuTableFilters`) passed only to
  // `<FilterMenu>`, while the focus effect calls the raw, unwrapped
  // `rawTableFilters.clearAll()` directly.
  const filterMenuTableFilters = {
    ...rawTableFilters,
    setFilter: (key: string, value: FilterValue | undefined) => {
      rawTableFilters.setFilter(key, value);
      setPage(1);
    },
    clearAll: () => {
      rawTableFilters.clearAll();
      setPage(1);
    },
  };

  const pageCount = Math.max(1, Math.ceil(mergedRows.length / PAGE_SIZE));

  useEffect(() => {
    if (page > pageCount) setPage(pageCount);
  }, [page, pageCount]);

  const pagedRows = mergedRows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  // Post-Save precheck toast's "jump to it" action: clear the filters (so
  // the target row can't be filtered out of view), then select the target's
  // page, computed against the UNFILTERED merged list.
  //
  // B7 — the `Object.keys(...).length > 0` guard is load-bearing, not
  // cosmetic: `rawTableFilters.clearAll()` (`useTableFilters.ts`) always
  // calls `setFilterState({})` with a BRAND NEW object, which React never
  // bails out of (unlike the pre-migration `setFromFilter("")`'s idempotent
  // same-primitive-value bail-out). `mergedRowsAll` is itself a new array
  // reference on every render whenever `referenceCapable` is falsy (its own
  // `referencePairs = referenceQuery.data?.pairs ?? []` yields a fresh `[]`
  // each render while `data` stays undefined) — this effect's own
  // `[focusEntityId, mergedRowsAll]` deps therefore re-fire every render,
  // and an unconditional `clearAll()` would re-trigger a state change every
  // time, an infinite render loop. Only actually clear when there's
  // something to clear.
  useEffect(() => {
    if (!focusEntityId) return;
    if (Object.keys(rawTableFilters.filterState).length > 0) rawTableFilters.clearAll();
    const idx = mergedRowsAll.findIndex(r => r.fromId === focusEntityId || r.toId === focusEntityId);
    if (idx < 0) return;
    setPage(Math.floor(idx / PAGE_SIZE) + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusEntityId, mergedRowsAll]);

  useEffect(() => {
    if (!focusEntityId) return;
    const prefix = "row-jadedistance-";
    for (const row of Array.from(document.querySelectorAll(`[data-testid^="${prefix}"]`))) {
      const suffix = (row.getAttribute("data-testid") ?? "").slice(prefix.length);
      if (suffix.includes(`-${focusEntityId}-`) || suffix.endsWith(`-${focusEntityId}`) || suffix.startsWith(`${focusEntityId}-`)) {
        row.scrollIntoView({ block: "center" });
        break;
      }
    }
  }, [focusEntityId, page, pagedRows]);

  // True when the row's override presence/value differs from the SAVED
  // state, including a just-cleared-but-unsaved override.
  function isChangedRow(r: MergedRow): boolean {
    const key = tripleKey(r.leg, r.fromId, r.toId);
    const saved = savedByKey.get(key);
    const current = r.override;
    if (!saved && !current) return false;
    if (!saved || !current) return true;
    return saved.distance !== current.distance;
  }

  // Whole-value validation: `Number(raw.trim())`, NOT `parseFloat`, which
  // would silently accept a numeric-prefix string like "12abc" as 12.
  function editOverride(r: MergedRow, raw: string) {
    const key = tripleKey(r.leg, r.fromId, r.toId);
    setDrafts(prev => ({ ...prev, [key]: raw }));
    const trimmed = raw.trim();
    if (trimmed === "") {
      setErrors(prev => {
        if (!(key in prev)) return prev;
        const next = { ...prev };
        delete next[key];
        return next;
      });
      return;
    }
    const n = Number(trimmed);
    if (!Number.isFinite(n) || n <= 0) {
      setErrors(prev => ({ ...prev, [key]: "Distance must be a positive number." }));
      return;
    }
    setErrors(prev => {
      if (!(key in prev)) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
    const nextOverride: JadeDistanceOverride = { leg: r.leg, fromId: r.fromId, toId: r.toId, distance: n, estimated: undefined };
    onChange(
      overrideByKey.has(key)
        ? distanceOverrides.map(o => (tripleKey(o.leg, o.fromId, o.toId) === key ? nextOverride : o))
        : [...distanceOverrides, nextOverride],
    );
  }

  function clearOverride(r: MergedRow) {
    const key = tripleKey(r.leg, r.fromId, r.toId);
    onChange(distanceOverrides.filter(o => tripleKey(o.leg, o.fromId, o.toId) !== key));
    setDrafts(prev => {
      if (!(key in prev)) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
    setErrors(prev => {
      if (!(key in prev)) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }

  function draftFor(r: MergedRow): string {
    const key = tripleKey(r.leg, r.fromId, r.toId);
    return drafts[key] ?? (r.override ? String(r.override.distance) : "");
  }

  // loading: base cells show a spinner (not "—"), added-entity override rows
  // stay editable. error: base cells show "unavailable", override rows stay
  // editable. Only on SUCCESS does a genuinely base-absent pair (`base ===
  // null`) show "—".
  function baseCell(r: MergedRow) {
    if (referenceCapable) {
      if (referenceQuery.isLoading) {
        return (
          <Spinner
            className="w-3 h-3"
            data-testid={`spinner-jadedistance-base-${r.leg}-${r.fromId}-${r.toId}`}
          />
        );
      }
      if (referenceQuery.isError) return "unavailable";
    }
    return r.base == null ? "—" : r.base;
  }

  function fromRoleId(leg: JadeLeg): Set<string> {
    return leg === "plant_to_warehouse" ? plantIdSet : warehouseIdSet;
  }
  function toRoleId(leg: JadeLeg): Set<string> {
    return leg === "plant_to_warehouse" ? warehouseIdSet : customerIdSet;
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
    if (distanceOverrides.some(o => o.leg === newLeg && o.fromId === fromId && o.toId === toId)) {
      setAddError("A distance override for this (leg, from, to) triple already exists — edit it in the table instead.");
      return;
    }

    setAddError(null);
    onChange([...distanceOverrides, { leg: newLeg, fromId, toId, distance }]);
    setNewFrom("");
    setNewTo("");
    setNewDistance("");
    setAddingRow(false);
  }

  function cancelAddRow() {
    setAddingRow(false);
    setNewLeg("plant_to_warehouse");
    setNewFrom("");
    setNewTo("");
    setNewDistance("");
    setAddError(null);
  }

  const toolbar = (
    <div className="flex items-center gap-1.5 mb-2 flex-wrap" data-testid="jadedistances-tab-toolbar">
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
      {mergedRowsAll.length > 10 && (
        <FilterMenu descriptors={distanceFilterDescriptors} tableFilters={filterMenuTableFilters} />
      )}
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
    <div className="flex items-start gap-1.5 mt-2 flex-wrap" data-testid="add-jadedistance-row-form">
      <select
        value={newLeg}
        onChange={e => setNewLeg(e.target.value as JadeLeg)}
        className="h-7 text-xs border rounded px-1"
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
        data-testid="input-new-jadedistance-from"
      />
      <Input
        placeholder="To ID"
        value={newTo}
        onChange={e => setNewTo(e.target.value)}
        className="h-7 text-xs w-36"
        data-testid="input-new-jadedistance-to"
      />
      <Input
        type="number"
        placeholder="Distance"
        value={newDistance}
        onChange={e => setNewDistance(e.target.value)}
        className="h-7 text-xs w-24 font-mono"
        data-testid="input-new-jadedistance-value"
      />
      <Button size="sm" className="h-7 px-2 text-xs" onClick={handleAddRow} data-testid="button-add-jadedistance-confirm">
        Add
      </Button>
      <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={cancelAddRow} data-testid="button-add-jadedistance-cancel">
        Cancel
      </Button>
    </div>
  ) : (
    <Button
      size="sm"
      variant="outline"
      className="h-7 px-2 text-xs mt-2"
      onClick={() => setAddingRow(true)}
      data-testid="button-add-jadedistance-row"
    >
      + Add row
    </Button>
  );

  const referenceErrorBanner = referenceCapable && referenceQuery.isError && (
    <p className="text-xs text-destructive mb-2" data-testid="jadedistances-reference-error">
      Failed to load reference distances.
    </p>
  );
  const referenceLoadingBanner = referenceCapable && referenceQuery.isLoading && (
    <p className="text-xs text-muted-foreground mb-2" data-testid="jadedistances-reference-loading">
      Loading reference distances…
    </p>
  );

  const tableSection =
    mergedRowsAll.length === 0 ? (
      <p className="text-sm text-muted-foreground" data-testid="jade-distances-tab-empty">
        No distance overrides yet — add one below, or upload a CSV/JSON file.
      </p>
    ) : (
      <>
        <div className="max-h-[55vh] overflow-y-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Leg</TableHead>
                <TableHead>From</TableHead>
                <TableHead>To</TableHead>
                <TableHead>Base</TableHead>
                <TableHead>Override</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {pagedRows.map(r => {
                const key = tripleKey(r.leg, r.fromId, r.toId);
                const changed = isChangedRow(r);
                const fromUnknown = !fromRoleId(r.leg).has(r.fromId);
                const toUnknown = !toRoleId(r.leg).has(r.toId);
                const error = errors[key];
                return (
                  <TableRow
                    key={key}
                    data-testid={`row-jadedistance-${r.leg}-${r.fromId}-${r.toId}`}
                    className={changed ? "bg-amber-50" : r.override?.estimated ? "bg-sky-50" : undefined}
                  >
                    <TableCell>
                      <Badge variant="secondary" data-testid={`badge-leg-${r.leg}-${r.fromId}-${r.toId}`}>
                        {LEG_LABEL[r.leg]}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs">
                      <div className="flex items-center gap-1">
                        <EntityIdCell
                          entityId={r.fromId}
                          displayId={resolvedDisplayId(r.fromId)}
                          location={resolvedLocation(r.fromId)}
                        />
                        {fromUnknown && (
                          <span
                            title="Unknown ID for this leg's From role"
                            data-testid={`warning-unknown-from-${r.leg}-${r.fromId}-${r.toId}`}
                          >
                            <AlertTriangle className="w-3 h-3 text-amber-600" />
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-xs">
                      <div className="flex items-center gap-1">
                        <EntityIdCell
                          entityId={r.toId}
                          displayId={resolvedDisplayId(r.toId)}
                          location={resolvedLocation(r.toId)}
                        />
                        {toUnknown && (
                          <span
                            title="Unknown ID for this leg's To role"
                            data-testid={`warning-unknown-to-${r.leg}-${r.fromId}-${r.toId}`}
                          >
                            <AlertTriangle className="w-3 h-3 text-amber-600" />
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="font-mono text-xs">{baseCell(r)}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5">
                        {/* text (not type="number") — a native number input's
                            own sanitization silently strips a malformed
                            string like "12abc" to "" before onChange fires,
                            which would make the whole-value Number()-vs-
                            parseFloat distinction below unreachable. */}
                        <Input
                          type="text"
                          inputMode="decimal"
                          value={draftFor(r)}
                          onChange={e => editOverride(r, e.target.value)}
                          aria-invalid={error ? "true" : undefined}
                          className={`h-7 text-xs w-24 font-mono ${error ? "border-destructive" : ""}`}
                          data-testid={`input-jadedistance-${r.leg}-${r.fromId}-${r.toId}`}
                        />
                        {r.override?.estimated && (
                          <span
                            className="text-[10px] text-sky-700 bg-sky-100 border border-sky-300 rounded px-1"
                            data-testid={`badge-jadedistance-estimated-${r.leg}-${r.fromId}-${r.toId}`}
                          >
                            Estimated
                          </span>
                        )}
                        {changed && (
                          <span
                            className="text-[10px] text-amber-700 bg-amber-100 border border-amber-300 rounded px-1"
                            data-testid={`badge-jadedistance-changed-${r.leg}-${r.fromId}-${r.toId}`}
                          >
                            Changed
                          </span>
                        )}
                      </div>
                      {error && (
                        <p
                          className="text-[11px] text-destructive mt-0.5"
                          data-testid={`text-jadedistance-error-${r.leg}-${r.fromId}-${r.toId}`}
                        >
                          {error}
                        </p>
                      )}
                    </TableCell>
                    <TableCell>
                      {(r.override || r.base == null) && (
                        <button
                          type="button"
                          aria-label={`Remove distance override ${r.fromId} → ${r.toId} (${LEG_LABEL[r.leg]})`}
                          onClick={() => clearOverride(r)}
                          data-testid={`button-remove-jadedistance-${r.leg}-${r.fromId}-${r.toId}`}
                          className="text-muted-foreground hover:text-destructive"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
              {mergedRows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-xs text-muted-foreground text-center py-3">
                    No rows match the current filter.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
        <Pager
          page={page}
          pageCount={pageCount}
          onPrev={() => setPage(p => Math.max(1, p - 1))}
          onNext={() => setPage(p => Math.min(pageCount, p + 1))}
          idPrefix="jadedistances"
        />
      </>
    );

  const mainSection = (
    <>
      {referenceErrorBanner}
      {referenceLoadingBanner}
      {tableSection}
    </>
  );

  return (
    <div data-testid="jade-distances-tab">
      {toolbar}
      {/* `jadedistances-reference-section` compat wrapper mirrors
          DistancesTab.tsx's `distances-reference-section` — present exactly
          when the model actually has a base×base matrix. */}
      {referenceCapable ? <div data-testid="jadedistances-reference-section">{mainSection}</div> : mainSection}

      {addRowUi}
      {addError && (
        <p className="text-[11px] text-destructive mt-1" data-testid="text-add-jadedistance-error">
          {addError}
        </p>
      )}

      {importDialog}
    </div>
  );
}
