import { useMemo, useState } from "react";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { warehouseStatusPresentation } from "@/components/workspace/map/statusPresentation";
import { FilterMenu } from "@/components/tables/FilterMenu";
import { useTableFilters, type ColumnFilterDescriptor } from "@/lib/useTableFilters";

export interface WarehouseOverride { id: string; capacity?: number | null; status: "active" | "forced_open" | "inactive"; }

interface WarehouseRow { id: string; city: string; state: string; lat: number; lng: number; zip?: string; }

// B6 (JADE Ch.9 Workspace Bundle, spec §10) — the row shape `useTableFilters`
// actually filters over: a base `WarehouseRow` plus its DERIVED status (from
// `overrides`, the same lookup the table body already does per-row via
// `getOverride`). Kept local to this file — no other caller needs it.
interface FilterableWarehouseRow extends WarehouseRow {
  status: WarehouseOverride["status"];
}

interface WarehouseTableProps {
  warehouses: WarehouseRow[];
  overrides: WarehouseOverride[];
  capacityMode: "none" | "uniform" | "per_wh";
  onChange: (next: WarehouseOverride[]) => void;
  /** Chen's Cosmetics (chens-cosmetics-cn) has no state data — every row's `state` is "". Gates the State column on/off; defaults true (every existing caller has real state data and is unaffected). */
  hasStateColumn?: boolean;
  /** B6 (spec §10) — opt-in FilterMenu (JADE-first). Defaults `false`: every
   * existing caller (Studio.tsx's Overrides dialog, WarehousesTab.tsx for
   * every non-JADE model) renders EXACTLY as before this task — the
   * underlying `useTableFilters` hook is still called unconditionally (rules
   * of hooks), but with no FilterMenu ever mounted, its filter state can
   * never become non-empty, so `filteredRows` always equals the unfiltered
   * rows and the render output is byte-identical. Only the JADE Workspace
   * path (via `WarehousesTab`'s own `enableFilters`, wired by INT) passes
   * `true`. */
  enableFilters?: boolean;
}

const STATUSES = ["active", "forced_open", "inactive"] as const;
// DD-6 (SCN v0.3 plan, `docs/superpowers/plans/2026-08-20-scn-v0.3-workspace.md`):
// "Status vocabulary is display-only mapping. UI labels Potential /
// Fixed-Open / Inactive <-> stored enum active / forced_open / inactive.
// One mapping constant in the frontend; no API or schema change." That one
// constant now lives in `map/statusPresentation.ts` (T4, Input Map v2) —
// shared with EntityMarkers/MapLegend/WarehouseTable so the label vocabulary
// can't drift between callers. The stored/API enum (and every `data-testid`,
// which still uses the raw enum values below) is untouched.

export function WarehouseTable({ warehouses, overrides, capacityMode, onChange, hasStateColumn = true, enableFilters = false }: WarehouseTableProps) {
  // Local draft text, keyed by warehouse id — decoupled from the committed
  // override so an in-progress keystroke isn't snapped back before the user
  // finishes typing (same rationale as CustomerTable's demand drafts).
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const getOverride = (id: string) => overrides.find(o => o.id === id);

  function upsert(id: string, patch: Partial<WarehouseOverride>) {
    const existing = getOverride(id);
    const merged: WarehouseOverride = {
      id,
      status: existing?.status ?? "active",
      capacity: existing?.capacity,
      ...patch,
    };
    const rest = overrides.filter(o => o.id !== id);
    const isNoOp = merged.status === "active" && merged.capacity == null;
    onChange(isNoOp ? rest : [...rest, merged]);
  }

  // B6 (spec §10) — always computed (rules of hooks: no early return above
  // this point), regardless of `enableFilters`. With no FilterMenu ever
  // mounted when `enableFilters` is false, `filterState` can never become
  // non-empty (there's no control to set it), so `filteredRows` always
  // equals `filterRows` unchanged — see `displayRows` below.
  const filterRows = useMemo<FilterableWarehouseRow[]>(
    () => warehouses.map(w => ({ ...w, status: getOverride(w.id)?.status ?? "active" })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [warehouses, overrides],
  );
  const filterDescriptors = useMemo<ColumnFilterDescriptor<FilterableWarehouseRow>[]>(() => {
    const descriptors: ColumnFilterDescriptor<FilterableWarehouseRow>[] = [
      { key: "id", label: "ID", type: "text", accessor: w => w.id },
      { key: "city", label: "City", type: "text", accessor: w => w.city },
    ];
    if (hasStateColumn) {
      descriptors.push({ key: "state", label: "State", type: "select", accessor: w => (w.state ? w.state : undefined) });
    }
    descriptors.push({
      key: "status",
      label: "Status",
      type: "select",
      accessor: w => warehouseStatusPresentation[w.status].label,
    });
    return descriptors;
  }, [hasStateColumn]);
  const tableFilters = useTableFilters(filterRows, filterDescriptors);
  const displayRows = enableFilters ? tableFilters.filteredRows : filterRows;

  return (
    <div>
      {enableFilters && tableFilters.totalCount > 10 && (
        <div className="flex justify-end mb-1.5" data-testid="warehouse-table-filter-bar">
          <FilterMenu descriptors={filterDescriptors} tableFilters={tableFilters} />
        </div>
      )}
      <div className="max-h-[60vh] overflow-y-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>ID</TableHead>
            <TableHead>City</TableHead>
            {hasStateColumn && <TableHead>State</TableHead>}
            <TableHead>Latitude</TableHead>
            <TableHead>Longitude</TableHead>
            {warehouses.some(w => w.zip) && <TableHead>Zip</TableHead>}
            {capacityMode === "per_wh" && <TableHead>Capacity</TableHead>}
            <TableHead>Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {displayRows.map(wh => {
            const o = getOverride(wh.id);
            const status = o?.status ?? "active";
            return (
              <TableRow key={wh.id}>
                <TableCell className="font-mono text-xs">{wh.id}</TableCell>
                <TableCell className="text-xs">{wh.city}</TableCell>
                {hasStateColumn && <TableCell className="text-xs">{wh.state}</TableCell>}
                <TableCell className="text-xs font-mono">{wh.lat.toFixed(4)}</TableCell>
                <TableCell className="text-xs font-mono">{wh.lng.toFixed(4)}</TableCell>
                {warehouses.some(w => w.zip) && <TableCell className="text-xs font-mono">{wh.zip ?? "—"}</TableCell>}
                {capacityMode === "per_wh" && (
                  <TableCell>
                    <Input
                      type="number"
                      min={0}
                      value={drafts[wh.id] ?? String(o?.capacity ?? "")}
                      onChange={e => {
                        const raw = e.target.value;
                        setDrafts(prev => ({ ...prev, [wh.id]: raw }));
                        const capacity = raw === "" ? null : Math.max(0, parseInt(raw, 10) || 0);
                        upsert(wh.id, { capacity });
                      }}
                      className="h-7 text-xs w-28 font-mono"
                      placeholder="uniform"
                      data-testid={`input-wh-capacity-${wh.id}`}
                    />
                  </TableCell>
                )}
                <TableCell>
                  <div className="flex rounded border border-border overflow-hidden text-[10px] w-fit">
                    {STATUSES.map(s => (
                      <button
                        key={s}
                        data-testid={`button-wh-${wh.id}-${s}`}
                        onClick={() => upsert(wh.id, { status: s })}
                        className={`px-2 py-1 transition-colors whitespace-nowrap ${
                          status === s
                            ? s === "forced_open" ? "bg-primary text-white" : s === "inactive" ? "bg-destructive text-white" : "bg-slate-200 text-foreground"
                            : "bg-white text-muted-foreground hover:bg-muted"
                        }`}
                      >
                        {warehouseStatusPresentation[s].label}
                      </button>
                    ))}
                  </div>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      </div>
    </div>
  );
}
