import { useState } from "react";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Input } from "@/components/ui/input";

export interface WarehouseOverride { id: string; capacity?: number | null; status: "active" | "forced_open" | "inactive"; }

interface WarehouseRow { id: string; city: string; state: string; }

interface WarehouseTableProps {
  warehouses: WarehouseRow[];
  overrides: WarehouseOverride[];
  capacityMode: "none" | "uniform" | "per_wh";
  onChange: (next: WarehouseOverride[]) => void;
}

const STATUSES = ["active", "forced_open", "inactive"] as const;
const STATUS_LABEL: Record<(typeof STATUSES)[number], string> = {
  active: "Active",
  forced_open: "Forced open",
  inactive: "Inactive",
};

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
            <TableHead>City, State</TableHead>
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
                <TableCell className="text-xs">{wh.city}, {wh.state}</TableCell>
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
                      className="h-7 text-xs w-28"
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
                        {STATUS_LABEL[s]}
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
