import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Download, Upload, X } from "lucide-react";
import type { Scenario } from "@workspace/api-client-react";
import { useGetReferenceDistances, getGetReferenceDistancesQueryKey } from "@workspace/api-client-react";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { ImportDialog } from "@/components/ImportDialog";
import { downloadEntityExport } from "@/lib/exportEntity";

export interface DistanceOverride {
  fromId: string;
  toId: string;
  distance: number;
  /** T1 (Input Map v2) — true when this row was auto-filled by the backend's
   * haversine normalizer (services/autoDistance.ts) rather than entered or
   * imported by the student. Matches distanceOverrideSchema's own optional
   * `estimated` field exactly. Purely a display flag — editing the distance
   * (see `editOverride`) drops it, treating the edit as a confirmation. */
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
}

function pairKey(fromId: string, toId: string): string {
  return `${fromId}|${toId}`;
}

// Bundle 6.1, T2 — one shared pager over the single merged table (replaces
// Bundle 5 T5's two independent reference/overrides pagers).
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
// distanceOverrides array (B1.1), merged (Bundle 6.1, T2) with the model's
// read-only base×base reference matrix (B3) into ONE Customers-tab-styled
// table: every base pair shows its reference distance plus an editable
// Override cell; scenario-local added-entity pairs (no base counterpart)
// append with a "—" base and their override. Thin wrapper following
// WarehousesTab.tsx's shape (props in, onChange out, no internal
// data-fetching/save logic for the overrides themselves) — but unlike
// WarehousesTab/CustomersTab there's no fixed dataset baseline to enumerate
// rows from beyond the reference matrix, so this component owns its own
// inline table rather than wrapping a components/tables/*Table.tsx (mirrors
// OptimizationParametersTab.tsx's precedent of a Workspace tab with no
// separate table component underneath it).
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
}: DistancesTabProps) {
  const [fromFilter, setFromFilter] = useState("");
  const [toFilter, setToFilter] = useState("");
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [importOpen, setImportOpen] = useState(false);
  const [addingRow, setAddingRow] = useState(false);
  const [newFrom, setNewFrom] = useState("");
  const [newTo, setNewTo] = useState("");
  const [newDistance, setNewDistance] = useState("");
  const [addError, setAddError] = useState<string | null>(null);

  // Bundle 6.1, T2 — a single pager over the merged row list (was two
  // independent pagers, one per table, before the merge).
  const PAGE_SIZE = 50;
  const [page, setPage] = useState(1);

  // B3 (Bundle 2.2) — called UNCONDITIONALLY (Rules of Hooks) with `enabled`
  // gating the actual request: an unsupported model (referenceCapable false,
  // e.g. Brazil) or an unresolved modelId must never fire this request (the
  // server 422s an unsupported model). `staleTime: Infinity` — the base
  // matrix is immutable (DD-1), fetched once per model per session; a tab
  // remount must not revalidate.
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

  // B3 — client-side view filter over the immutable base×base reference
  // matrix (DD-1: base data never mutates). Purely derived from live
  // `localInputs`-sourced status props — no refetch, instant recompute on
  // every render.
  const inactiveWarehouseIdSet = useMemo(() => new Set(inactiveWarehouseIds ?? []), [inactiveWarehouseIds]);
  const excludedCustomerIdSet = useMemo(() => new Set(excludedCustomerIds ?? []), [excludedCustomerIds]);
  const referencePairs = referenceQuery.data?.pairs ?? [];

  // Resolution #3 (plan review) — the complete base-key set, built BEFORE any
  // view filter, so a pair carrying a CURRENT or SAVED override can always be
  // recognized as such regardless of its live status.
  const baseByKey = useMemo(() => new Map(referencePairs.map(p => [pairKey(p.fromId, p.toId), p])), [referencePairs]);
  const overrideByKey = useMemo(
    () => new Map(distanceOverrides.map(o => [pairKey(o.fromId, o.toId), o])),
    [distanceOverrides],
  );
  const savedByKey = useMemo(
    () => new Map(savedDistanceOverrides.map(o => [pairKey(o.fromId, o.toId), o])),
    [savedDistanceOverrides],
  );

  // Resolution #8 — a base pair's fromCode/toCode always echo its fromId/toId
  // (ReferenceDistancePair's own contract: "base entities' id IS already a
  // short display code"), and `displayCodeById` never carries an entry for a
  // base id (only scenario-local added entities have one) — so filtering on
  // `displayValue(id)` is exactly equivalent to filtering base rows on
  // fromCode/toCode and added rows on displayCodeById?.[id] ?? id, without
  // needing two separate filter predicates.
  const displayValue = (id: string) => displayCodeById?.[id] ?? id;

  // Resolution #2/#3 — complete, UNFILTERED (no text search) merged row list:
  // a base pair passes when it's active/included OR it carries a current or
  // saved override (a saved-but-now-cleared override is a pending deletion
  // that must stay visible + "Changed" until Save). Used both to derive the
  // text-filtered `mergedRows` below and — deliberately independent of the
  // live fromFilter/toFilter state — to compute the focusEntityId page jump
  // and the true "nothing here at all" empty state (Bundle 5 T5's original
  // "compute against the unfiltered array" approach, retargeted to the
  // merged shape).
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

  function matchesText(fromDisp: string, toDisp: string): boolean {
    return (
      fromDisp.toLowerCase().includes(fromFilter.toLowerCase()) && toDisp.toLowerCase().includes(toFilter.toLowerCase())
    );
  }

  const mergedRows: MergedRow[] = useMemo(
    () => mergedRowsAll.filter(r => matchesText(displayValue(r.fromId), displayValue(r.toId))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [mergedRowsAll, fromFilter, toFilter, displayCodeById],
  );

  const pageCount = Math.max(1, Math.ceil(mergedRows.length / PAGE_SIZE));

  // Clamp DOWN whenever the filtered length shrinks (delete/import overrides,
  // toggle inactive/excluded, narrow the filter) so we never strand on a
  // now-empty page. This only ever reduces the page; it never fights the
  // focus jump below (which sets a valid in-range page).
  useEffect(() => {
    if (page > pageCount) setPage(pageCount);
  }, [page, pageCount]);

  const pagedRows = mergedRows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  // Phase 3.2, Task 4 / Bundle 5 T5 (retargeted to the merged row list,
  // Bundle 6.1 T2) — the post-Save precheck toast's "jump to it" action:
  // clear the filters (so the target row can't be filtered out of view),
  // then select the target's page, computed against the UNFILTERED merged
  // list so the jump doesn't race the (async) filter-clearing state update.
  useEffect(() => {
    if (!focusEntityId) return;
    setFromFilter("");
    setToFilter("");
    const idx = mergedRowsAll.findIndex(r => r.fromId === focusEntityId || r.toId === focusEntityId);
    if (idx < 0) return;
    setPage(Math.floor(idx / PAGE_SIZE) + 1);
  }, [focusEntityId, mergedRowsAll]);

  // Scroll once the target page has rendered (runs after `page` updates above).
  useEffect(() => {
    if (!focusEntityId) return;
    const prefix = "row-distance-";
    for (const row of Array.from(document.querySelectorAll(`[data-testid^="${prefix}"]`))) {
      const suffix = (row.getAttribute("data-testid") ?? "").slice(prefix.length);
      if (suffix.startsWith(`${focusEntityId}-`) || suffix.endsWith(`-${focusEntityId}`)) {
        row.scrollIntoView({ block: "center" });
        break;
      }
    }
  }, [focusEntityId, page, pagedRows]);

  // Resolution #4 — true when the row's override presence/value differs from
  // the SAVED state, including a just-cleared-but-unsaved override (saved had
  // it, current doesn't) → still "Changed" until Save.
  function isChangedRow(r: MergedRow): boolean {
    const key = pairKey(r.fromId, r.toId);
    const saved = savedByKey.get(key);
    const current = r.override;
    if (!saved && !current) return false;
    if (!saved || !current) return true;
    return saved.distance !== current.distance;
  }

  // Resolution #4/#7 — whole-value validation: `Number(raw.trim())`, NOT
  // `parseFloat`, which would silently accept a numeric-prefix string like
  // "12abc" as 12. An empty draft is the mid-clear state (no error, no
  // commit); a non-empty draft that isn't a finite positive number is
  // invalid (inline error, no onChange); a valid positive number upserts the
  // override, dropping any `estimated` flag (editing is a confirm action).
  function editOverride(r: MergedRow, raw: string) {
    const key = pairKey(r.fromId, r.toId);
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
    const nextOverride: DistanceOverride = { fromId: r.fromId, toId: r.toId, distance: n, estimated: undefined };
    onChange(
      overrideByKey.has(key)
        ? distanceOverrides.map(o => (pairKey(o.fromId, o.toId) === key ? nextOverride : o))
        : [...distanceOverrides, nextOverride],
    );
  }

  // Resolution #4 — removes the override (base row reverts to base; an
  // added-entity row disappears entirely) and drops any lingering draft/error
  // for this key so a stale invalid draft doesn't linger after Clear.
  function clearOverride(r: MergedRow) {
    const key = pairKey(r.fromId, r.toId);
    onChange(distanceOverrides.filter(o => pairKey(o.fromId, o.toId) !== key));
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
    const key = pairKey(r.fromId, r.toId);
    return drafts[key] ?? (r.override ? String(r.override.distance) : "");
  }

  // Resolution #6 — loading: base cells show a spinner (not "—"), added-entity
  // override rows stay editable. Error: base cells show "unavailable",
  // override rows stay editable. Only on SUCCESS does a genuinely base-absent
  // pair (`base === null`) show "—". When the model has no reference matrix
  // at all (`referenceCapable` falsy), there's no load/error state to report.
  function baseCell(r: MergedRow) {
    if (referenceCapable) {
      if (referenceQuery.isLoading) {
        return <Spinner className="w-3 h-3" data-testid={`spinner-distance-base-${r.fromId}-${r.toId}`} />;
      }
      if (referenceQuery.isError) return "unavailable";
    }
    return r.base == null ? "—" : r.base;
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
    <div className="flex items-center gap-1.5 mb-2 flex-wrap" data-testid="distances-tab-toolbar">
      <Button
        variant="outline"
        size="sm"
        onClick={() => scenarioId != null && downloadEntityExport(scenarioId, "distances", "csv")}
        disabled={scenarioId == null}
        data-testid="button-export-distances-csv"
        className="h-7 text-xs"
      >
        <Download className="w-3.5 h-3.5 mr-1" /> CSV
      </Button>
      <Button
        variant="outline"
        size="sm"
        onClick={() => scenarioId != null && downloadEntityExport(scenarioId, "distances", "json")}
        disabled={scenarioId == null}
        data-testid="button-export-distances-json"
        className="h-7 text-xs"
      >
        <Download className="w-3.5 h-3.5 mr-1" /> JSON
      </Button>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setImportOpen(true)}
        disabled={scenarioId == null}
        data-testid="button-import-distances"
        className="h-7 text-xs"
      >
        <Upload className="w-3.5 h-3.5 mr-1" /> Upload
      </Button>
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

  // Mounted only while actually open — mirrors WarehousesTab/CustomersTab's
  // gating (ImportDialog fires its preview/apply hooks unconditionally on
  // render).
  const importDialog = importOpen && scenarioId != null && (
    <ImportDialog
      open={importOpen}
      onOpenChange={setImportOpen}
      scenarioId={scenarioId}
      entity="distances"
      onApplied={onImportApplied}
    />
  );

  const addRowUi = addingRow ? (
    <div className="flex items-start gap-1.5 mt-2" data-testid="add-distance-row-form">
      <Input
        placeholder="From ID (warehouse)"
        value={newFrom}
        onChange={e => setNewFrom(e.target.value)}
        className="h-7 text-xs w-36"
        data-testid="input-new-distance-from"
      />
      <Input
        placeholder="To ID (customer)"
        value={newTo}
        onChange={e => setNewTo(e.target.value)}
        className="h-7 text-xs w-36"
        data-testid="input-new-distance-to"
      />
      <Input
        type="number"
        placeholder="Distance"
        value={newDistance}
        onChange={e => setNewDistance(e.target.value)}
        className="h-7 text-xs w-24 font-mono"
        data-testid="input-new-distance-value"
      />
      <Button size="sm" className="h-7 px-2 text-xs" onClick={handleAddRow} data-testid="button-add-distance-confirm">
        Add
      </Button>
      <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={cancelAddRow} data-testid="button-add-distance-cancel">
        Cancel
      </Button>
    </div>
  ) : (
    <Button
      size="sm"
      variant="outline"
      className="h-7 px-2 text-xs mt-2"
      onClick={() => setAddingRow(true)}
      data-testid="button-add-distance-row"
    >
      + Add row
    </Button>
  );

  const referenceErrorBanner = referenceCapable && referenceQuery.isError && (
    <p className="text-xs text-destructive mb-2" data-testid="distances-reference-error">
      Failed to load reference distances.
    </p>
  );
  const referenceLoadingBanner = referenceCapable && referenceQuery.isLoading && (
    <p className="text-xs text-muted-foreground mb-2" data-testid="distances-reference-loading">
      Loading reference distances…
    </p>
  );

  // Bundle 6.1, T2 — ONE merged, Customers-tab-styled table (replaces Bundle
  // 5's two separate reference/overrides sections). Columns: From / To /
  // Base (read-only) / Override (editable) / actions — no city column
  // (resolution #5).
  const tableSection =
    mergedRowsAll.length === 0 ? (
      <p className="text-sm text-muted-foreground" data-testid="distances-tab-empty">
        No distance overrides yet — add one below, or upload a CSV/JSON file.
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
                <TableHead>Override</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {pagedRows.map(r => {
                const key = pairKey(r.fromId, r.toId);
                const changed = isChangedRow(r);
                const fromUnknown = !warehouseIdSet.has(r.fromId);
                const toUnknown = !customerIdSet.has(r.toId);
                const error = errors[key];
                return (
                  <TableRow
                    key={key}
                    data-testid={`row-distance-${r.fromId}-${r.toId}`}
                    className={changed ? "bg-amber-50" : r.override?.estimated ? "bg-sky-50" : undefined}
                  >
                    <TableCell className="font-mono text-xs">
                      <div className="flex items-center gap-1">
                        {displayCodeById?.[r.fromId] ?? r.fromId}
                        {fromUnknown && (
                          <span
                            title="Unknown warehouse ID — not found in this scenario's warehouses"
                            data-testid={`warning-unknown-from-${r.fromId}-${r.toId}`}
                          >
                            <AlertTriangle className="w-3 h-3 text-amber-600" />
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      <div className="flex items-center gap-1">
                        {displayCodeById?.[r.toId] ?? r.toId}
                        {toUnknown && (
                          <span
                            title="Unknown customer ID — not found in this scenario's customers"
                            data-testid={`warning-unknown-to-${r.fromId}-${r.toId}`}
                          >
                            <AlertTriangle className="w-3 h-3 text-amber-600" />
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="font-mono text-xs">{baseCell(r)}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5">
                        {/* text (not type="number") — see the note on why below:
                            a native number input's own value-sanitization
                            algorithm silently strips a malformed string like
                            "12abc" to "" before onChange ever fires, which
                            would make the whole-value Number()-vs-parseFloat
                            distinction below unreachable/untestable. */}
                        <Input
                          type="text"
                          inputMode="decimal"
                          value={draftFor(r)}
                          onChange={e => editOverride(r, e.target.value)}
                          aria-invalid={error ? "true" : undefined}
                          className={`h-7 text-xs w-24 font-mono ${error ? "border-destructive" : ""}`}
                          data-testid={`input-distance-${r.fromId}-${r.toId}`}
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
                      {error && (
                        <p
                          className="text-[11px] text-destructive mt-0.5"
                          data-testid={`text-distance-error-${r.fromId}-${r.toId}`}
                        >
                          {error}
                        </p>
                      )}
                    </TableCell>
                    <TableCell>
                      {(r.override || r.base == null) && (
                        <button
                          type="button"
                          aria-label={`Remove distance override ${r.fromId} → ${r.toId}`}
                          onClick={() => clearOverride(r)}
                          data-testid={`button-remove-distance-${r.fromId}-${r.toId}`}
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
                  <TableCell colSpan={5} className="text-xs text-muted-foreground text-center py-3">
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
          idPrefix="distances"
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
    <div data-testid="distances-tab">
      {toolbar}
      {/* `distances-reference-section` is a compat wrapper marking "this tab's
          merged table includes reference-distance data" — present exactly
          when the model actually has a base×base matrix (referenceCapable),
          preserving the presence/absence contract other call sites already
          depend on, even though (Bundle 6.1, T2) there's no longer a
          separate read-only sub-table nested inside it. */}
      {referenceCapable ? <div data-testid="distances-reference-section">{mainSection}</div> : mainSection}

      {addRowUi}
      {addError && (
        <p className="text-[11px] text-destructive mt-1" data-testid="text-add-distance-error">
          {addError}
        </p>
      )}

      {importDialog}
    </div>
  );
}
