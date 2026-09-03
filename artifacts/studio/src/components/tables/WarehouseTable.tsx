import { useState } from "react";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { warehouseStatusPresentation } from "@/components/workspace/map/statusPresentation";

export interface WarehouseOverride { id: string; capacity?: number | null; status: "active" | "forced_open" | "inactive"; }

interface WarehouseRow { id: string; city: string; state: string; lat: number; lng: number; zip?: string; }

interface WarehouseTableProps {
  warehouses: WarehouseRow[];
  overrides: WarehouseOverride[];
  capacityMode: "none" | "uniform" | "per_wh";
  onChange: (next: WarehouseOverride[]) => void;
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

export function WarehouseTable({ warehouses, overrides, capacityMode, onChange }: WarehouseTableProps) {
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

  return (
    <div className="max-h-[60vh] overflow-y-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>ID</TableHead>
            <TableHead>City</TableHead>
            <TableHead>State</TableHead>
            <TableHead>Latitude</TableHead>
            <TableHead>Longitude</TableHead>
            {warehouses.some(w => w.zip) && <TableHead>Zip</TableHead>}
            {capacityMode === "per_wh" && <TableHead>Capacity</TableHead>}
            <TableHead>Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {warehouses.map(wh => {
            const o = getOverride(wh.id);
            const status = o?.status ?? "active";
            return (
              <TableRow key={wh.id}>
                <TableCell className="font-mono text-xs">{wh.id}</TableCell>
                <TableCell className="text-xs">{wh.city}</TableCell>
                <TableCell className="text-xs">{wh.state}</TableCell>
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
  );
}
